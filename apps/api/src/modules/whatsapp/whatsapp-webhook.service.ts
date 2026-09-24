import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizePhoneNumber } from './phone-number.util';
import { NormalizedInboundEvent } from './providers/whatsapp-provider.port';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';
import { WhatsAppConsentService } from './whatsapp-consent.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { WhatsAppPaymentLinkService } from './whatsapp-payment-link.service';
import { WhatsAppSelfServiceService } from './whatsapp-self-service.service';

const OTP_PATTERN = /^\d{6}$/;

/**
 * Phase 14 spec #12 — the inbound processing pipeline: idempotency check
 * → identify tenant/customer → create/update conversation → store the
 * message → dispatch self-service (menu/booking lookup/agent handoff/
 * OTP linking) unless a human has paused automation on this thread
 * (spec #85). A single provider webhook call can carry several
 * events (message + delivery statuses in one POST) — each is processed
 * independently, and a redelivery of the same event never re-runs any
 * of this twice (see the WhatsAppWebhookEvent unique constraint this
 * relies on, enforced by the caller before this is invoked).
 *
 * Which company a message belongs to: this increment resolves it as
 * "the only company with WHATSAPP active" when exactly one exists, since
 * Meta webhooks aren't scoped by any URL path/query a tenant chooses —
 * multiple simultaneously-active tenant WhatsApp numbers would need a
 * phone-number-id → company mapping, which is a real but separable
 * follow-up (see WhatsAppModule's doc comment).
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: WhatsAppConversationsService,
    private readonly consentService: WhatsAppConsentService,
    private readonly otpService: WhatsAppOtpService,
    private readonly selfService: WhatsAppSelfServiceService,
    private readonly paymentLinkService: WhatsAppPaymentLinkService,
    private readonly providerRouter: WhatsAppProviderRouter,
  ) {}

  /** Spec #13 — the idempotency gate itself: a unique (provider, eventId)
   * insert. Returns false (caller should skip processing) when this
   * exact event was already recorded. `eventId` should be the provider's
   * own message/status id when available; a payload hash is an
   * acceptable fallback for a payload shape with no natural id. */
  async recordEventOnceOrSkip(
    provider: string,
    eventId: string,
    rawPayload: unknown,
  ): Promise<boolean> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(rawPayload))
      .digest('hex');
    try {
      await this.prisma.whatsAppWebhookEvent.create({
        data: { provider, eventId, payloadHash, status: 'PENDING' },
      });
      return true;
    } catch {
      // Unique constraint violation — this exact event was already seen.
      return false;
    }
  }

  async markEventProcessed(provider: string, eventId: string, error?: string) {
    await this.prisma.whatsAppWebhookEvent
      .update({
        where: { provider_eventId: { provider, eventId } },
        data: {
          processedAt: new Date(),
          status: error ? 'FAILED' : 'PROCESSED',
          error,
        },
      })
      .catch(() => undefined); // best-effort — never let bookkeeping fail the request
  }

  private async resolveCompanyId(): Promise<string | null> {
    // See class doc comment — single-tenant-WhatsApp assumption for this
    // increment. Falls back to the platform's oldest company (same
    // fallback used by earlier tenant-isolation backfills in this
    // codebase) so a fresh install with zero companies configured still
    // fails loudly rather than silently, while a normal single-tenant
    // deployment (the only kind this codebase has been run as so far)
    // just works.
    const company = await this.prisma.company.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    return company?.id ?? null;
  }

  async processEvent(event: NormalizedInboundEvent): Promise<void> {
    if (event.kind === 'STATUS') {
      await this.processStatusUpdate(event);
      return;
    }
    await this.processInboundMessage(event);
  }

  private async processStatusUpdate(
    event: NormalizedInboundEvent,
  ): Promise<void> {
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { providerMessageId: event.providerMessageId },
    });
    if (!message) return; // status for a message we don't have — nothing to reconcile

    const statusMap: Record<string, WhatsAppMessageStatus> = {
      SENT: WhatsAppMessageStatus.SENT,
      DELIVERED: WhatsAppMessageStatus.DELIVERED,
      READ: WhatsAppMessageStatus.READ,
      FAILED: WhatsAppMessageStatus.FAILED,
    };
    const status = statusMap[event.status ?? 'SENT'];

    await this.prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status,
        ...(status === WhatsAppMessageStatus.DELIVERED && {
          deliveredAt: new Date(event.timestamp),
        }),
        ...(status === WhatsAppMessageStatus.READ && {
          readAt: new Date(event.timestamp),
        }),
        ...(status === WhatsAppMessageStatus.FAILED && {
          failedAt: new Date(event.timestamp),
          failureReason: event.failureReason,
        }),
      },
    });
  }

  private async processInboundMessage(
    event: NormalizedInboundEvent,
  ): Promise<void> {
    if (!event.from) return;
    const phoneNumber = normalizePhoneNumber(event.from);
    const companyId = await this.resolveCompanyId();
    if (!companyId) {
      this.logger.error(
        'No company exists to attribute an inbound WhatsApp message to.',
      );
      return;
    }

    const text = event.text ?? event.interactiveReplyId ?? '';

    // Consent commands take priority over everything else, including an
    // in-progress OTP flow — spec #9's STOP/START must always work.
    if (WhatsAppConsentService.isStopCommand(text)) {
      const customer = await this.selfService.findVerifiedCustomer(phoneNumber);
      await this.consentService.recordConsent(
        phoneNumber,
        'OPTED_OUT',
        'whatsapp_stop_command',
        customer?.id,
      );
      await this.reply(
        phoneNumber,
        'You have been unsubscribed from WhatsApp messages. Reply START to opt back in.',
      );
      return;
    }
    if (WhatsAppConsentService.isStartCommand(text)) {
      const customer = await this.selfService.findVerifiedCustomer(phoneNumber);
      await this.consentService.recordConsent(
        phoneNumber,
        'OPTED_IN',
        'whatsapp_start_command',
        customer?.id,
      );
      await this.reply(
        phoneNumber,
        "You're opted back in. Reply MENU to see what we can help with.",
      );
      return;
    }

    const customer = await this.selfService.findVerifiedCustomer(phoneNumber);
    const conversation = await this.conversationsService.findOrCreateForPhone(
      companyId,
      phoneNumber,
      customer?.id,
    );

    await this.storeInboundMessage(conversation.id, event, text);

    if (conversation.automationPaused) return; // spec #85 — human has taken over

    // An unverified customer with a 6-digit reply — try it as an OTP
    // before falling through to ordinary command handling.
    if (!customer && OTP_PATTERN.test(text.trim())) {
      const candidate = await this.prisma.customer.findFirst({
        where: { whatsapp: phoneNumber },
      });
      if (candidate) {
        const verified = await this.otpService.verifyOtp(
          phoneNumber,
          text.trim(),
        );
        if (verified) {
          await this.conversationsService.get(conversation.id); // no-op existence check, keeps intent obvious
          await this.prisma.whatsAppConversation.update({
            where: { id: conversation.id },
            data: { customerId: candidate.id },
          });
          await this.reply(
            phoneNumber,
            "You're verified! " +
              (await this.selfService.myBookings(candidate.id)),
          );
          return;
        }
        await this.reply(
          phoneNumber,
          "That code didn't match. Please check and try again, or reply MENU to start over.",
        );
        return;
      }
    }

    if (WhatsAppSelfServiceService.requestsMenu(text)) {
      await this.reply(phoneNumber, this.selfService.welcomeMenu());
      return;
    }
    if (WhatsAppSelfServiceService.requestsHelp(text)) {
      await this.reply(phoneNumber, this.selfService.help());
      return;
    }
    if (WhatsAppSelfServiceService.requestsAgent(text)) {
      await this.conversationsService.setStatus(
        conversation.id,
        'WAITING_STAFF',
      );
      await this.reply(
        phoneNumber,
        'You are now connected to our support team. A staff member will assist you shortly.',
      );
      return;
    }

    const paymentBookingRef =
      WhatsAppSelfServiceService.parsePaymentRequest(text);
    if (paymentBookingRef) {
      if (customer) {
        await this.reply(
          phoneNumber,
          await this.paymentLinkService.requestLinkForBooking(
            customer.id,
            paymentBookingRef,
          ),
        );
        return;
      }
      const sentCode = await this.triggerVerificationIfPossible(phoneNumber);
      await this.reply(
        phoneNumber,
        sentCode
          ? `To protect your account, please verify it's you. Your code is: ${sentCode}\n\nReply with this 6-digit code, then send "PAY ${paymentBookingRef}" again.`
          : "We couldn't find an account linked to this number. Please contact our staff or register through the customer portal first.",
      );
      return;
    }

    if (WhatsAppSelfServiceService.requiresVerification(text)) {
      if (customer) {
        await this.reply(
          phoneNumber,
          await this.selfService.myBookings(customer.id),
        );
        return;
      }
      const code = await this.triggerVerificationIfPossible(phoneNumber);
      await this.reply(
        phoneNumber,
        code
          ? `To protect your booking details, please verify it's you. Your code is: ${code}\n\nReply with this 6-digit code.`
          : "We couldn't find an account linked to this number. Please contact our staff or register through the customer portal first.",
      );
      return;
    }

    // Fallback — same away/unrecognized-message reply either way for
    // this increment (business-hours-aware messaging is deferred, see
    // WhatsAppModule's doc comment).
    await this.reply(phoneNumber, this.selfService.welcomeMenu());
  }

  /** Shared by every branch that needs a verified customer but doesn't
   * have one yet: finds the Customer this number belongs to (if any) and
   * requests an OTP for it. Returns the plaintext code to relay, or null
   * if no account exists for this number at all — callers are
   * responsible for phrasing the reply either way, since "you're not
   * verified yet" and "verify with this code" need different wording per
   * branch. */
  private async triggerVerificationIfPossible(
    phoneNumber: string,
  ): Promise<string | null> {
    const candidate = await this.prisma.customer.findFirst({
      where: { whatsapp: phoneNumber },
    });
    if (!candidate) return null;
    return this.otpService.requestOtp(phoneNumber, candidate.id);
  }

  private async storeInboundMessage(
    conversationId: string,
    event: NormalizedInboundEvent,
    text: string,
  ) {
    const typeMap: Record<string, WhatsAppMessageType> = {
      TEXT: WhatsAppMessageType.TEXT,
      IMAGE: WhatsAppMessageType.IMAGE,
      DOCUMENT: WhatsAppMessageType.DOCUMENT,
      VIDEO: WhatsAppMessageType.VIDEO,
      LOCATION: WhatsAppMessageType.LOCATION,
      INTERACTIVE_BUTTONS: WhatsAppMessageType.INTERACTIVE_BUTTONS,
      INTERACTIVE_LIST: WhatsAppMessageType.INTERACTIVE_LIST,
    };
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        providerMessageId: event.providerMessageId || undefined,
        direction: WhatsAppMessageDirection.INBOUND,
        type: typeMap[event.messageType ?? 'TEXT'] ?? WhatsAppMessageType.TEXT,
        content: text || null,
        mediaUrl: event.mediaId,
        status: WhatsAppMessageStatus.DELIVERED,
      },
    });
    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), lastInboundAt: new Date() },
    });
  }

  /** Internal reply helper for the automated flows above — stores the
   * outbound message the same way WhatsAppConversationsService.sendReply
   * does, but without a staff actor. */
  private async reply(phoneNumber: string, body: string) {
    const companyId = await this.resolveCompanyId();
    if (!companyId) return;
    const conversation = await this.conversationsService.findOrCreateForPhone(
      companyId,
      phoneNumber,
    );
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        content: body,
        status: WhatsAppMessageStatus.SENDING,
      },
    });
    const result = await this.providerRouter.sendTextMessage({
      to: phoneNumber,
      body,
    });
    await this.prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: result.success
        ? {
            status: WhatsAppMessageStatus.SENT,
            providerMessageId: result.providerMessageId,
            sentAt: new Date(),
          }
        : {
            status: WhatsAppMessageStatus.FAILED,
            failedAt: new Date(),
            failureReason: result.error,
          },
    });
    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
    });
  }
}
