import { Injectable, Logger } from '@nestjs/common';
import {
  CommChannel,
  CommDeliveryEventType,
  CommRecipientStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CommConsentService } from './comm-consent.service';

export interface DeliveryEventInput {
  channel: CommChannel;
  providerMessageId: string;
  type: CommDeliveryEventType;
  occurredAt: Date;
  /** The provider's own id for this event, so a redelivered webhook is applied once. */
  providerEventId?: string;
  detail?: string;
  /** Came from the built-in simulator, not a real provider. Stored and reported as such. */
  simulated?: boolean;
  /** Email bounces: a permanent failure (true) or a temporary one (false). */
  hardBounce?: boolean;
}

export type DeliveryOutcome = 'APPLIED' | 'DUPLICATE' | 'UNKNOWN_MESSAGE';

const RANK: Partial<Record<CommRecipientStatus, number>> = {
  QUEUED: 0,
  SENDING: 0,
  UNCERTAIN: 1,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};
const UNDELIVERABLE =
  /not a whatsapp|undeliverable|invalid|131026|does not exist|no such user/i;

/**
 * What providers tell us happened to a message after it was accepted: delivered, read, bounced, reported as spam,
 * clicked. Only what a provider actually reports is recorded; nothing is inferred. Bounces and complaints immediately
 * add the address to the suppression list.
 */
@Injectable()
export class CommDeliveryService {
  private readonly logger = new Logger(CommDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: CommConsentService,
  ) {}

  async apply(e: DeliveryEventInput): Promise<DeliveryOutcome> {
    const recipient = await this.prisma.commCampaignRecipient.findFirst({
      where: {
        providerMessageId: e.providerMessageId,
        campaign: { channel: e.channel },
      },
      include: { campaign: { select: { id: true, companyId: true } } },
    });
    const service = recipient
      ? null
      : await this.prisma.commTransactionalMessage.findFirst({
          where: { providerMessageId: e.providerMessageId, channel: e.channel },
          select: { id: true, companyId: true, contactId: true },
        });
    if (!recipient && !service) return 'UNKNOWN_MESSAGE';

    const companyId = recipient?.campaign.companyId ?? service!.companyId;
    const contactId = recipient?.contactId ?? service!.contactId ?? undefined;

    try {
      await this.prisma.commDeliveryEvent.create({
        data: {
          companyId,
          campaignId: recipient?.campaign.id,
          recipientId: recipient?.id,
          channel: e.channel,
          type: e.type,
          providerMessageId: e.providerMessageId,
          providerEventId:
            e.providerEventId ?? `${e.providerMessageId}:${e.type}`,
          simulated: e.simulated ?? false,
          occurredAt: e.occurredAt,
          detail: e.detail?.slice(0, 300),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return 'DUPLICATE';
      throw err;
    }

    if (recipient)
      await this.updateRecipient(recipient.id, recipient.status, e);
    if (contactId) await this.sideEffects(companyId, contactId, e);
    return 'APPLIED';
  }

  private async updateRecipient(
    id: string,
    current: CommRecipientStatus,
    e: DeliveryEventInput,
  ) {
    const data: Prisma.CommCampaignRecipientUpdateManyMutationInput = {};
    const rank = RANK[current] ?? 0;
    switch (e.type) {
      case 'DELIVERED':
        if (rank < 2) {
          data.status = 'DELIVERED';
          data.deliveredAt = e.occurredAt;
        }
        break;
      case 'READ':
        if (rank < 3) {
          data.status = 'READ';
          data.readAt = e.occurredAt;
          if (rank < 2) data.deliveredAt = e.occurredAt;
        }
        break;
      case 'FAILED':
        if (rank < 2) {
          data.status = 'FAILED';
          data.failedAt = e.occurredAt;
          data.lastError =
            e.detail?.slice(0, 300) ?? 'The provider reported a failure.';
        }
        break;
      case 'BOUNCED':
        data.bouncedAt = e.occurredAt;
        if (e.hardBounce !== false) {
          data.status = 'FAILED';
          data.failedAt = e.occurredAt;
          data.lastError = e.detail?.slice(0, 300) ?? 'Bounced';
        }
        break;
      case 'COMPLAINT':
        data.complainedAt = e.occurredAt;
        break;
      case 'CLICKED':
        data.clickedAt = e.occurredAt;
        break;
      case 'UNSUBSCRIBED':
        data.unsubscribedAt = e.occurredAt;
        break;
      default:
        break;
    }
    if (Object.keys(data).length)
      await this.prisma.commCampaignRecipient.update({ where: { id }, data });
  }

  /** Bounces, complaints and undeliverable numbers protect the sender's reputation and the person's choice. */
  private async sideEffects(
    companyId: string,
    contactId: string,
    e: DeliveryEventInput,
  ) {
    const type = e.channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
    const addresses = await this.prisma.commContactChannel.findMany({
      where: { contactId, type },
      select: { id: true, value: true },
    });
    if (e.type === 'BOUNCED' && e.hardBounce !== false) {
      for (const a of addresses) {
        await this.consent.suppressAddress({
          companyId,
          channel: e.channel,
          value: a.value,
          reason: 'BOUNCED',
          source: 'PROVIDER_BOUNCE',
          contactId,
        });
        await this.prisma.commContactChannel.update({
          where: { id: a.id },
          data: { invalid: true },
        });
      }
    } else if (e.type === 'COMPLAINT') {
      // The person withdrew in the strongest way they can: stop at once, and never allow this address back by a list import.
      await this.consent
        .record({
          companyId,
          contactId,
          channel: e.channel,
          action: 'WITHDRAWN',
          source: 'PROVIDER_COMPLAINT',
          evidence: { providerMessageId: e.providerMessageId },
        })
        .catch((err) =>
          this.logger.warn(`Complaint withdrawal: ${(err as Error).message}`),
        );
      for (const a of addresses)
        await this.consent.suppressAddress({
          companyId,
          channel: e.channel,
          value: a.value,
          reason: 'COMPLAINT',
          source: 'PROVIDER_COMPLAINT',
          contactId,
        });
    } else if (
      e.type === 'FAILED' &&
      e.channel === 'WHATSAPP' &&
      e.detail &&
      UNDELIVERABLE.test(e.detail)
    ) {
      await this.prisma.commContactChannel.updateMany({
        where: { contactId, type: 'PHONE' },
        data: { invalid: true },
      });
    }
  }
}
