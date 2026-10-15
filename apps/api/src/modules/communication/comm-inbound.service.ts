import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CommDeliveryEventType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WhatsAppConsentService } from '../whatsapp/whatsapp-consent.service';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';
import { normalisePhone } from './comm-identifiers';
import {
  CLARIFICATION,
  classifyConsentReply,
  classifyEnquiry,
  guessLanguage,
  OPT_OUT_ACK,
} from './comm-inbound-intent';
import { CommConsentService } from './comm-consent.service';
import { CommContactsService } from './comm-contacts.service';
import { CommDeliveryService } from './comm-delivery.service';
import { CommOutboundService } from './comm-outbound.service';

export interface InboundPayload {
  companyId: string;
  phoneNumber: string;
  text: string;
  providerMessageId: string;
}
export interface InboundResult {
  /** True when this layer fully dealt with the message; the conversation flow must not also answer it. */
  handled: boolean;
}
export interface StatusPayload {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  timestamp: string;
  failureReason?: string;
}

const STATUS_TYPE: Record<StatusPayload['status'], CommDeliveryEventType> = {
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
};

/**
 * What the Communication Centre does with inbound WhatsApp traffic, in two ways:
 *
 *  1. Marketing consent. STOP, UNSUBSCRIBE and their Hausa and Arabic equivalents withdraw marketing consent at once;
 *     an unclear word ("cancel", "no") gets a short question instead of a guess; START/CONFIRM from someone who had
 *     asked to subscribe completes it. Transactional messages about a person's own bookings are not affected.
 *  2. Enquiries. Other messages are labelled (package, flight, visa, Hajj/Umrah, booking status, human) and logged, for
 *     routing and for the reports. This layer never answers one with prices, availability or booking facts.
 *
 * It is reached through events the WhatsApp module emits, so that module never depends on this one.
 */
@Injectable()
export class CommInboundService {
  private readonly logger = new Logger(CommInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: CommConsentService,
    private readonly contacts: CommContactsService,
    private readonly delivery: CommDeliveryService,
    private readonly outbound: CommOutboundService,
    private readonly whatsapp: WhatsAppProviderRouter,
    private readonly waConsent: WhatsAppConsentService,
  ) {}

  private async log(
    p: InboundPayload,
    contactId: string | undefined,
    intent: string,
    confidence: string,
    actionTaken: string,
  ) {
    await this.prisma.commInboundLog
      .create({
        data: {
          companyId: p.companyId,
          providerMessageId: p.providerMessageId || `anon-${Date.now()}`,
          contactId,
          intent,
          confidence,
          actionTaken,
        },
      })
      .catch(() => undefined); // a repeated delivery of the same message is simply already logged
  }

  @OnEvent('whatsapp.inbound')
  async onInbound(p: InboundPayload): Promise<InboundResult> {
    try {
      return await this.handle(p);
    } catch (e) {
      this.logger.error(`Inbound handling failed: ${(e as Error).message}`);
      return { handled: false };
    }
  }

  private async handle(p: InboundPayload): Promise<InboundResult> {
    const phone = normalisePhone(p.phoneNumber, '');
    if (!phone) return { handled: false };
    const existing = await this.prisma.commContactChannel.findFirst({
      where: {
        companyId: p.companyId,
        type: 'PHONE',
        value: phone,
        contact: { status: 'ACTIVE' },
      },
      select: {
        contact: {
          select: { id: true, fullName: true, preferredLanguage: true },
        },
      },
    });
    const contact = existing?.contact;
    const lang =
      (contact?.preferredLanguage as 'en' | 'ha' | 'ar' | undefined) ??
      guessLanguage(p.text);
    const intent = classifyConsentReply(p.text);

    if (intent === 'OPT_OUT') {
      await this.consent.withdrawByAddress({
        companyId: p.companyId,
        channel: 'WHATSAPP',
        value: phone,
        source: 'WHATSAPP_REPLY',
        evidence: { providerMessageId: p.providerMessageId },
      });
      await this.log(
        p,
        contact?.id,
        'OPT_OUT',
        'HIGH',
        'Marketing consent withdrawn',
      );
      // The plain English words are also handled (and answered) by the conversation flow; do not answer twice.
      if (WhatsAppConsentService.isStopCommand(p.text))
        return { handled: false };
      await this.waConsent.recordConsent(
        phone,
        'OPTED_OUT',
        'whatsapp_stop_keyword',
      );
      await this.outbound.sendWhatsAppText(phone, OPT_OUT_ACK[lang]);
      return { handled: true };
    }

    if (intent === 'OPT_OUT_UNCLEAR') {
      await this.log(
        p,
        contact?.id,
        'OPT_OUT_UNCLEAR',
        'LOW',
        'Asked the person to clarify',
      );
      await this.outbound.sendWhatsAppText(phone, CLARIFICATION[lang]);
      return { handled: true };
    }

    if (intent === 'CONFIRM' || intent === 'OPT_IN') {
      const sub = contact
        ? await this.prisma.commSubscription.findUnique({
            where: {
              contactId_channel: { contactId: contact.id, channel: 'WHATSAPP' },
            },
          })
        : null;
      const wasPending = sub?.status === 'PENDING_CONFIRMATION';
      const wasUnsubscribed = sub?.status === 'UNSUBSCRIBED';
      // START by someone who never asked for marketing only turns the conversation back on (handled elsewhere).
      if (contact && (wasPending || wasUnsubscribed)) {
        await this.consent.record({
          companyId: p.companyId,
          contactId: contact.id,
          channel: 'WHATSAPP',
          action: wasPending ? 'CONFIRMED' : 'GRANTED',
          source: 'WHATSAPP_REPLY',
          evidence: { providerMessageId: p.providerMessageId },
          doubleOptIn: false,
          text: 'Person replied to our WhatsApp message to confirm.',
        });
        await this.waConsent.recordConsent(
          phone,
          'OPTED_IN',
          'whatsapp_confirm_reply',
        );
        await this.log(
          p,
          contact.id,
          intent,
          'HIGH',
          wasPending
            ? 'Subscription confirmed'
            : "Subscribed again at the person's request",
        );
        if (!WhatsAppConsentService.isStartCommand(p.text)) {
          await this.outbound.sendWhatsAppText(
            phone,
            'Thank you, you are subscribed. Reply STOP at any time to unsubscribe.',
          );
          return { handled: true };
        }
        return { handled: false };
      }
      await this.log(
        p,
        contact?.id,
        intent,
        'LOW',
        'No pending subscription; nothing changed',
      );
      return { handled: false };
    }

    const enquiry = classifyEnquiry(p.text);
    if (enquiry.intent !== 'OTHER')
      await this.log(
        p,
        contact?.id,
        enquiry.intent,
        enquiry.confidence,
        'Logged for staff; not answered automatically',
      );
    return { handled: false };
  }

  @OnEvent('whatsapp.status')
  async onStatus(s: StatusPayload): Promise<void> {
    try {
      const simulated = (await this.whatsapp.activeProviderName()) === 'mock';
      await this.delivery.apply({
        channel: 'WHATSAPP',
        providerMessageId: s.providerMessageId,
        type: STATUS_TYPE[s.status],
        occurredAt: new Date(s.timestamp),
        providerEventId: `${s.providerMessageId}:${s.status}`,
        detail: s.failureReason,
        simulated,
      });
    } catch (e) {
      this.logger.error(
        `Delivery status handling failed: ${(e as Error).message}`,
      );
    }
  }
}
