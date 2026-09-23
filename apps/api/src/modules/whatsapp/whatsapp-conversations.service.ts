import { Injectable, NotFoundException } from '@nestjs/common';
import {
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhoneNumber } from './phone-number.util';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';

/**
 * Phase 14 — the conversation/message store and the one place that
 * actually calls WhatsAppProviderRouter to send. Every read/write here
 * takes `tenantCompanyId` (resolveTenantFilter(user) from the caller,
 * same NotFound-not-Forbidden pattern as every other tenant-scoped
 * lookup in this codebase) — a cross-tenant conversation id must come
 * back indistinguishable from a missing one, since WhatsApp message
 * content is exactly the kind of private customer data spec #4
 * (tenant isolation) exists to protect.
 */
@Injectable()
export class WhatsAppConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providerRouter: WhatsAppProviderRouter,
  ) {}

  /** Finds the open-ish conversation for this phone number within this
   * company, or creates a new one — called by the webhook processor for
   * every inbound message. One company can never see another's
   * conversation for the same number (each gets its own row), since a
   * phone number isn't itself a tenant boundary. */
  async findOrCreateForPhone(
    companyId: string,
    phoneNumber: string,
    customerId?: string,
  ) {
    const normalized = normalizePhoneNumber(phoneNumber);
    const existing = await this.prisma.whatsAppConversation.findFirst({
      where: {
        companyId,
        phoneNumber: normalized,
        status: { notIn: [WhatsAppConversationStatus.CLOSED] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    const created = await this.prisma.whatsAppConversation.create({
      data: {
        companyId,
        phoneNumber: normalized,
        customerId,
        branchId: customerId
          ? (
              await this.prisma.customer.findUnique({
                where: { id: customerId },
                select: { assignedBranchId: true },
              })
            )?.assignedBranchId
          : undefined,
      },
    });

    if (customerId) {
      await this.prisma.customerTimelineEvent.create({
        data: {
          customerId,
          type: 'WHATSAPP_CONVERSATION_STARTED',
          description: `WhatsApp conversation started (${normalized})`,
          relatedType: 'WHATSAPP_CONVERSATION',
          relatedId: created.id,
        },
      });
    }

    return created;
  }

  list(
    filters: {
      status?: WhatsAppConversationStatus;
      assignedStaffId?: string;
      branchId?: string;
    },
    tenantCompanyId: string | undefined,
    take = 50,
    cursor?: string,
  ) {
    return this.prisma.whatsAppConversation.findMany({
      where: {
        ...filters,
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        assignedStaff: { select: { firstName: true, lastName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
  }

  async get(id: string, tenantCompanyId?: string) {
    const conversation = await this.prisma.whatsAppConversation.findUnique({
      where: { id },
      include: {
        customer: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
    });
    if (
      !conversation ||
      (tenantCompanyId !== undefined &&
        conversation.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async listMessages(
    conversationId: string,
    tenantCompanyId: string | undefined,
    take = 50,
    cursor?: string,
  ) {
    await this.get(conversationId, tenantCompanyId);
    return this.prisma.whatsAppMessage.findMany({
      where: { conversationId },
      include: { sentByStaff: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
  }

  /** A staff reply inside an already-open conversation — direct
   * responses to an actively-messaging customer are never blocked by an
   * opt-out (spec #51 is about proactive/marketing sends, not replying
   * to someone who is right now talking to you); see
   * sendAutomatedMessage below for the path that DOES check consent. */
  async sendReply(
    conversationId: string,
    body: string,
    staffId: string,
    tenantCompanyId?: string,
  ) {
    const conversation = await this.get(conversationId, tenantCompanyId);

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        content: body,
        sentByStaffId: staffId,
        status: WhatsAppMessageStatus.SENDING,
      },
    });

    const result = await this.providerRouter.sendTextMessage({
      to: conversation.phoneNumber,
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
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
    });

    return { ...message, status: result.success ? 'SENT' : 'FAILED' };
  }

  /** Spec #43 — an automated/triggered send (booking-ticketed, a
   * reminder, etc.), gated by opt-in status and deduplicated by
   * `idempotencyKey` so a restarted job can never send the same
   * notification twice. Returns the existing row (no-op) if that key was
   * already used. */
  async sendAutomatedMessage(
    companyId: string,
    phoneNumber: string,
    body: string,
    idempotencyKey: string,
    customerId?: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    const existing = await this.prisma.whatsAppMessage.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return { sent: false, reason: 'already_sent' };

    if (customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { whatsappOptIn: true },
      });
      if (!customer?.whatsappOptIn) {
        return { sent: false, reason: 'not_opted_in' };
      }
    }

    const conversation = await this.findOrCreateForPhone(
      companyId,
      phoneNumber,
      customerId,
    );

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        content: body,
        status: WhatsAppMessageStatus.SENDING,
        idempotencyKey,
      },
    });

    const result = await this.providerRouter.sendTextMessage({
      to: conversation.phoneNumber,
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

    return { sent: result.success, reason: result.error };
  }

  async addInternalNote(
    conversationId: string,
    note: string,
    staffId: string,
    tenantCompanyId?: string,
  ) {
    await this.get(conversationId, tenantCompanyId);
    return this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.SYSTEM,
        content: note,
        sentByStaffId: staffId,
        isInternalNote: true,
        status: WhatsAppMessageStatus.SENT,
        sentAt: new Date(),
      },
    });
  }

  async assign(
    conversationId: string,
    staffId: string,
    tenantCompanyId?: string,
  ) {
    await this.get(conversationId, tenantCompanyId);
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        assignedStaffId: staffId,
        status: WhatsAppConversationStatus.ASSIGNED,
      },
    });
    await this.auditService.record({
      action: 'whatsapp.conversation.assigned',
      entityType: 'WhatsAppConversation',
      entityId: conversationId,
      metadata: { staffId },
    });
    return updated;
  }

  async setStatus(
    conversationId: string,
    status: WhatsAppConversationStatus,
    tenantCompanyId?: string,
  ) {
    await this.get(conversationId, tenantCompanyId);
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { status },
    });
    await this.auditService.record({
      action: 'whatsapp.conversation.status_changed',
      entityType: 'WhatsAppConversation',
      entityId: conversationId,
      metadata: { status },
    });
    return updated;
  }

  /** Spec #85 — staff takeover pauses the self-service menu/automation
   * for this conversation until released. */
  async setAutomationPaused(
    conversationId: string,
    paused: boolean,
    tenantCompanyId?: string,
  ) {
    await this.get(conversationId, tenantCompanyId);
    return this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { automationPaused: paused },
    });
  }
}
