import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommChannel,
  CommConsentAction,
  CommSuppressionReason,
  CommSubscriptionStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { FieldCipher } from '../../common/security/field-cipher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { applyConsentAction } from './comm-consent.policy';
import {
  maskEmail,
  maskPhone,
  newOpaqueToken,
  normaliseEmail,
  normalisePhone,
} from './comm-identifiers';
import { CommSettingsService } from './comm-settings.service';

type Tx = Prisma.TransactionClient;

export interface RecordConsentInput {
  companyId: string;
  contactId: string;
  channel: CommChannel;
  action: CommConsentAction;
  topics?: string[];
  /** WEBSITE_FORM | PREFERENCE_PAGE | EMAIL_LINK | WHATSAPP_REPLY | CONFIRMATION_LINK | ADMIN | IMPORT_ATTESTED ... */
  source: string;
  /** The wording the person saw, and its version. Stored with the record. */
  text?: string;
  textVersion?: string;
  evidence?: Record<string, unknown>;
  actorIdentityId?: string;
  /** Whether a grant has to be confirmed by the person before it takes effect. */
  doubleOptIn?: boolean;
  /** Skip the hard-suppression check; only for withdrawals, which are always allowed. */
  ipFingerprint?: string;
}

export interface RecordConsentResult {
  status: CommSubscriptionStatus;
  allowsMarketing: boolean;
  /** Present only when a confirmation has to be sent: the raw token goes in the link, only its hash is stored. */
  confirmToken?: string;
  recordId: string;
}

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Reasons a person's new consent cannot lift: a bounce, a spam complaint, an invalid address, or an administrator's
// deliberate block. (An UNSUBSCRIBED entry is the person's own choice and is lifted by their own new consent.)
const HARD_REASONS: CommSuppressionReason[] = [
  'BOUNCED',
  'COMPLAINT',
  'INVALID_ADDRESS',
  'ADMIN',
];

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Consent and suppression. The single place that decides whether a person may be marketed to on a channel.
 *
 *  - Every request, grant, confirmation and withdrawal is appended to CommConsentRecord (never edited).
 *  - A withdrawal takes effect at once and writes a durable suppression keyed by a keyed hash of the address, so
 *    deleting the contact or re-importing the same address cannot resubscribe it.
 *  - Only a new GRANTED/CONFIRMED action (with its evidence) lifts an unsubscribe. A bounce or a spam complaint can
 *    only be lifted by an administrator, with a reason, and even then does not grant consent.
 */
@Injectable()
export class CommConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: CommSettingsService,
  ) {}

  hashAddress(channel: CommChannel, value: string): string {
    return FieldCipher.default().keyedHash(
      value,
      `comm-suppression:${channel}`,
    );
  }

  /** The normalised form of an address for a channel, or null when it is not valid. */
  normaliseFor(channel: CommChannel, raw: string): string | null {
    return channel === 'EMAIL' ? normaliseEmail(raw) : normalisePhone(raw);
  }

  private hint(channel: CommChannel, value: string): string {
    return channel === 'EMAIL' ? maskEmail(value) : maskPhone(value);
  }

  async isSuppressed(
    companyId: string,
    channel: CommChannel,
    value: string,
    onlyHard = false,
  ): Promise<boolean> {
    const row = await this.prisma.commSuppression.findFirst({
      where: {
        companyId,
        channel,
        valueHash: this.hashAddress(channel, value),
        liftedAt: null,
        ...(onlyHard ? { reason: { in: HARD_REASONS } } : {}),
      },
      select: { id: true },
    });
    return !!row;
  }

  private async suppressTx(
    tx: Tx,
    p: {
      companyId: string;
      channel: CommChannel;
      value: string;
      reason: CommSuppressionReason;
      source: string;
      contactId?: string;
      actorIdentityId?: string;
    },
  ): Promise<void> {
    const valueHash = this.hashAddress(p.channel, p.value);
    await tx.commSuppression.upsert({
      where: {
        companyId_channel_valueHash: {
          companyId: p.companyId,
          channel: p.channel,
          valueHash,
        },
      },
      create: {
        companyId: p.companyId,
        channel: p.channel,
        valueHash,
        valueHint: this.hint(p.channel, p.value),
        reason: p.reason,
        source: p.source,
        contactId: p.contactId,
        createdByIdentityId: p.actorIdentityId,
      },
      // A stronger, hard reason is never downgraded to a plain unsubscribe by a later withdrawal.
      update: {
        liftedAt: null,
        liftedReason: null,
        ...(p.reason !== 'UNSUBSCRIBED' ? { reason: p.reason } : {}),
        source: p.source,
      },
    });
  }

  /** Suppress an address directly (bounce, complaint, an admin's block, or a STOP from an unknown number). */
  async suppressAddress(p: {
    companyId: string;
    channel: CommChannel;
    value: string;
    reason: CommSuppressionReason;
    source: string;
    contactId?: string;
    actorIdentityId?: string;
  }): Promise<void> {
    const value = this.normaliseFor(p.channel, p.value);
    if (!value) throw new BadRequestException('That is not a valid address.');
    await this.prisma.$transaction((tx) =>
      this.suppressTx(tx, { ...p, value }),
    );
  }

  /**
   * An administrator removes a suppression entry. An UNSUBSCRIBED entry is the person's own decision and a
   * COMPLAINT is a spam report: neither can be lifted here, only a new consent from the person does that.
   * A BOUNCED/INVALID_ADDRESS/ADMIN entry can be lifted with a reason - and the contact stays non-subscribed.
   */
  async lift(
    companyId: string,
    id: string,
    reason: string,
    actorIdentityId: string,
  ): Promise<void> {
    const row = await this.prisma.commSuppression.findFirst({
      where: { id, companyId, liftedAt: null },
    });
    if (!row) throw new NotFoundException('Suppression entry not found');
    if (row.reason === 'UNSUBSCRIBED')
      throw new ConflictException(
        'This person unsubscribed. Only a new subscription from them (with their consent recorded) can lift it.',
      );
    if (row.reason === 'COMPLAINT')
      throw new ConflictException(
        'This address reported our message as spam. It cannot be lifted from here.',
      );
    await this.prisma.commSuppression.update({
      where: { id },
      data: { liftedAt: new Date(), liftedReason: reason },
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.suppression_lifted',
      entityType: 'CommSuppression',
      entityId: id,
      reason,
      metadata: { channel: row.channel, previousReason: row.reason },
    });
  }

  async listSuppressions(
    companyId: string | undefined,
    q: {
      channel?: CommChannel;
      reason?: string;
      includeLifted?: boolean;
      page?: number;
      pageSize?: number;
    },
  ) {
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const page = q.page ?? 1;
    const where: Prisma.CommSuppressionWhereInput = {
      ...(companyId ? { companyId } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.reason ? { reason: q.reason as CommSuppressionReason } : {}),
      ...(q.includeLifted ? {} : { liftedAt: null }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.commSuppression.count({ where }),
      this.prisma.commSuppression.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          channel: true,
          valueHint: true,
          reason: true,
          source: true,
          createdAt: true,
          liftedAt: true,
          liftedReason: true,
          contactId: true,
        },
      }),
    ]);
    return { total, page, pageSize, items: rows };
  }

  /**
   * Records a consent action and updates the current state in one transaction. See the class comment for the rules.
   * A grant for an address that is on a hard suppression (bounce/complaint/invalid) is refused.
   */
  async record(input: RecordConsentInput): Promise<RecordConsentResult> {
    const settings = await this.settings.get(input.companyId);
    const allowedTopics = new Set(
      this.settings.topics(settings).map((t) => t.key),
    );
    const topics = (input.topics ?? []).filter((t) => allowedTopics.has(t));
    if ((input.topics ?? []).length !== topics.length)
      throw new BadRequestException('One of the chosen topics is not offered.');

    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.commContact.findFirst({
        where: { id: input.contactId, companyId: input.companyId },
        include: { channels: true },
      });
      if (!contact || contact.status !== 'ACTIVE')
        throw new NotFoundException('Contact not found');

      const type = input.channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
      const addresses = contact.channels.filter((c) => c.type === type);
      const grants =
        input.action === 'GRANTED' ||
        input.action === 'CONFIRMED' ||
        input.action === 'REQUESTED';
      if (grants && addresses.length === 0)
        throw new BadRequestException(
          input.channel === 'EMAIL'
            ? 'This contact has no email address.'
            : 'This contact has no phone number.',
        );

      if (grants) {
        for (const a of addresses) {
          const hard = await tx.commSuppression.findFirst({
            where: {
              companyId: input.companyId,
              channel: input.channel,
              valueHash: this.hashAddress(input.channel, a.value),
              liftedAt: null,
              reason: { in: HARD_REASONS },
            },
            select: { reason: true },
          });
          if (hard)
            throw new ConflictException(
              'This address cannot receive marketing because of an earlier bounce, complaint or invalid result.',
            );
        }
      }

      const sub = await tx.commSubscription.findUnique({
        where: {
          contactId_channel: { contactId: contact.id, channel: input.channel },
        },
      });
      const current = sub?.status ?? 'NONE';
      const doubleOptIn =
        input.doubleOptIn ??
        (input.channel === 'EMAIL' && settings.doubleOptInEmail);
      const next = applyConsentAction(current, input.action, { doubleOptIn });

      let confirmToken: string | undefined;
      if (
        next.status === 'PENDING_CONFIRMATION' &&
        (input.action === 'GRANTED' || input.action === 'REQUESTED')
      )
        confirmToken = newOpaqueToken();

      const record = await tx.commConsentRecord.create({
        data: {
          companyId: input.companyId,
          contactId: contact.id,
          channel: input.channel,
          action: input.action,
          topics,
          source: input.source,
          text: input.text,
          textVersion: input.textVersion,
          evidence: (input.evidence ?? undefined) as
            Prisma.InputJsonValue | undefined,
          actorIdentityId: input.actorIdentityId,
          confirmTokenHash: confirmToken ? sha256(confirmToken) : undefined,
          confirmExpiresAt: confirmToken
            ? new Date(Date.now() + CONFIRM_TTL_MS)
            : undefined,
        },
      });

      const becameSubscribed =
        next.status === 'SUBSCRIBED' && current !== 'SUBSCRIBED';
      const keepTopics =
        input.action === 'GRANTED' || input.action === 'REQUESTED'
          ? topics
          : (sub?.topics ?? []);
      await tx.commSubscription.upsert({
        where: {
          contactId_channel: { contactId: contact.id, channel: input.channel },
        },
        create: {
          contactId: contact.id,
          companyId: input.companyId,
          channel: input.channel,
          status: next.status,
          topics: keepTopics,
          subscribedAt: becameSubscribed ? new Date() : null,
          unsubscribedAt: next.status === 'UNSUBSCRIBED' ? new Date() : null,
          lastRecordId: record.id,
        },
        update: {
          status: next.status,
          topics: keepTopics,
          ...(becameSubscribed ? { subscribedAt: new Date() } : {}),
          ...(input.action === 'WITHDRAWN'
            ? { unsubscribedAt: new Date() }
            : {}),
          lastRecordId: record.id,
        },
      });

      if (input.action === 'WITHDRAWN') {
        for (const a of addresses)
          await this.suppressTx(tx, {
            companyId: input.companyId,
            channel: input.channel,
            value: a.value,
            reason: 'UNSUBSCRIBED',
            source: input.source,
            contactId: contact.id,
            actorIdentityId: input.actorIdentityId,
          });
      } else if (next.allowsMarketing) {
        // A new, valid consent lifts a plain unsubscribe (never a bounce or complaint, which were checked above).
        await tx.commSuppression.updateMany({
          where: {
            companyId: input.companyId,
            channel: input.channel,
            valueHash: {
              in: addresses.map((a) =>
                this.hashAddress(input.channel, a.value),
              ),
            },
            reason: 'UNSUBSCRIBED',
            liftedAt: null,
          },
          data: {
            liftedAt: new Date(),
            liftedReason: `New consent (${input.source})`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          identityId: input.actorIdentityId,
          companyId: input.companyId,
          action: `comm.consent_${input.action.toLowerCase()}`,
          entityType: 'CommContact',
          entityId: contact.id,
          metadata: {
            channel: input.channel,
            source: input.source,
            from: current,
            to: next.status,
          },
        },
      });

      return {
        status: next.status,
        allowsMarketing: next.allowsMarketing,
        confirmToken,
        recordId: record.id,
      };
    });
  }

  /**
   * The person follows the link in the confirmation message. Single use, expiring, and it cannot revive a
   * withdrawal made after the request.
   */
  async confirm(token: string): Promise<{
    result: 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'EXPIRED' | 'INVALID';
    channel?: CommChannel;
  }> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { result: 'INVALID' };
    const request = await this.prisma.commConsentRecord.findFirst({
      where: { confirmTokenHash: sha256(token) },
    });
    if (!request) return { result: 'INVALID' };
    const later = await this.prisma.commConsentRecord.findFirst({
      where: {
        contactId: request.contactId,
        channel: request.channel,
        createdAt: { gt: request.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    });
    if (later?.action === 'CONFIRMED')
      return { result: 'ALREADY_CONFIRMED', channel: request.channel };
    // Anything the person did after asking (a withdrawal, a newer request) supersedes this link.
    if (later) return { result: 'INVALID' };
    if (request.confirmExpiresAt && request.confirmExpiresAt < new Date())
      return { result: 'EXPIRED', channel: request.channel };
    await this.record({
      companyId: request.companyId,
      contactId: request.contactId,
      channel: request.channel,
      action: 'CONFIRMED',
      source: 'CONFIRMATION_LINK',
      evidence: { requestRecordId: request.id },
    });
    return { result: 'CONFIRMED', channel: request.channel };
  }

  /**
   * A STOP / unsubscribe from an address. Works with or without a matching contact: the address is suppressed
   * either way, so a person we have no record of is still never messaged again.
   */
  async withdrawByAddress(p: {
    companyId: string;
    channel: CommChannel;
    value: string;
    source: string;
    evidence?: Record<string, unknown>;
  }): Promise<{ contactId?: string }> {
    const value = this.normaliseFor(p.channel, p.value);
    if (!value) throw new BadRequestException('That is not a valid address.');
    const type = p.channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
    const channelRows = await this.prisma.commContactChannel.findMany({
      where: { companyId: p.companyId, type, value },
      select: { contactId: true },
    });
    if (channelRows.length === 0) {
      await this.suppressAddress({
        companyId: p.companyId,
        channel: p.channel,
        value,
        reason: 'UNSUBSCRIBED',
        source: p.source,
      });
      return {};
    }
    for (const row of channelRows)
      await this.record({
        companyId: p.companyId,
        contactId: row.contactId,
        channel: p.channel,
        action: 'WITHDRAWN',
        source: p.source,
        evidence: p.evidence,
      });
    return { contactId: channelRows[0].contactId };
  }

  /** Consent history of one contact, newest first. Evidence is shown without anything that identifies the device. */
  async history(companyId: string | undefined, contactId: string) {
    const contact = await this.prisma.commContact.findFirst({
      where: { id: contactId, ...(companyId ? { companyId } : {}) },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const rows = await this.prisma.commConsentRecord.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        channel: true,
        action: true,
        topics: true,
        source: true,
        textVersion: true,
        text: true,
        evidence: true,
        actorIdentityId: true,
        createdAt: true,
      },
    });
    return rows;
  }
}
