import { Injectable, Logger } from '@nestjs/common';
import {
  CommCampaign,
  CommChannel,
  CommSettings,
  CommTemplate,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { marketingEligibility } from './comm-consent.policy';
import { CommConsentService } from './comm-consent.service';
import { CommCampaignsService } from './comm-campaigns.service';
import { retryDelayMs, tickBudget } from './comm-campaign.rules';
import { CommMessageBuilder, TemplateContent } from './comm-message.builder';
import { CommOutboundService } from './comm-outbound.service';
import { normalisePhone } from './comm-identifiers';
import { CommSettingsService } from './comm-settings.service';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';

export const TICK_SECONDS = 15;
const LEASE_SECONDS = 180;
const CHANNELS: CommChannel[] = ['WHATSAPP', 'EMAIL'];

export interface TickReport {
  started: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  uncertain: number;
  completed: number;
  held: string[];
}

/**
 * The sending queue. One pass (a "tick") starts campaigns that are due, hands a rate-limited batch of recipients to
 * the provider, and closes campaigns that have nothing left to do.
 *
 * Safety properties, each tested:
 *  - a recipient is claimed with a database lock and a lease, so two workers cannot send the same message;
 *  - a lease that runs out means the outcome is unknown: the recipient is flagged UNCERTAIN and never re-sent
 *    automatically, so a crash cannot cause a duplicate marketing message;
 *  - consent, suppression, topic, the kill switch and test mode are checked again for each person at the moment of
 *    sending, not just when the audience was chosen;
 *  - failures that may pass are retried with a delay up to three times; the rest are recorded and not retried.
 */
@Injectable()
export class CommSenderService {
  private readonly logger = new Logger(CommSenderService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CommSettingsService,
    private readonly consent: CommConsentService,
    private readonly campaigns: CommCampaignsService,
    private readonly builder: CommMessageBuilder,
    private readonly outbound: CommOutboundService,
    private readonly whatsapp: WhatsAppProviderRouter,
  ) {}

  /** Runs one pass. Calls that overlap are ignored, so a slow tick is never doubled up. */
  async tick(): Promise<TickReport | null> {
    if (this.running) return null;
    this.running = true;
    const report: TickReport = {
      started: 0,
      claimed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      uncertain: 0,
      completed: 0,
      held: [],
    };
    try {
      // 1. scheduled campaigns whose time has come
      const due = await this.prisma.commCampaign.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
        select: { id: true, companyId: true },
      });
      for (const d of due) {
        const s = await this.settings.get(d.companyId);
        if (s.killSwitch) {
          report.held.push(`${d.id}: kill switch`);
          continue;
        }
        try {
          await this.campaigns.beginSending(d.companyId, d.id);
          report.started++;
        } catch (e) {
          this.logger.error(
            `Could not start campaign ${d.id}: ${(e as Error).message}`,
          );
        }
      }

      // 2. a send that was interrupted has an unknown outcome: flag it, never resend it
      const stale = await this.prisma.commCampaignRecipient.updateMany({
        where: { status: 'SENDING', leaseUntil: { lt: new Date() } },
        data: {
          status: 'UNCERTAIN',
          lastError:
            'Sending was interrupted. Check with the provider before sending to this person again.',
        },
      });
      report.uncertain += stale.count;

      // 3. send a batch for every company with a live campaign
      const live = await this.prisma.commCampaign.findMany({
        where: { status: 'SENDING' },
        select: { companyId: true },
        distinct: ['companyId'],
      });
      for (const { companyId } of live) {
        const s = await this.settings.get(companyId);
        if (s.killSwitch) {
          report.held.push(`${companyId}: kill switch`);
          continue;
        }
        for (const channel of CHANNELS)
          await this.sendBatch(companyId, channel, s, report);
      }

      // 4. close campaigns with nothing left to do
      const open = await this.prisma.commCampaign.findMany({
        where: { status: 'SENDING' },
        select: { id: true },
      });
      for (const c of open)
        if (await this.closeIfDone(c.id)) report.completed++;
    } finally {
      this.running = false;
    }
    return report;
  }

  private async sendBatch(
    companyId: string,
    channel: CommChannel,
    s: CommSettings,
    report: TickReport,
  ) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const sent24 = await this.prisma.commCampaignRecipient.count({
      where: {
        companyId,
        sentAt: { gte: since },
        campaign: { channel },
        status: { in: ['SENT', 'DELIVERED', 'READ', 'UNCERTAIN'] },
      },
    });
    const perMinute =
      channel === 'WHATSAPP'
        ? s.whatsappMessagesPerMinute
        : s.emailMessagesPerMinute;
    const budget = tickBudget(perMinute, TICK_SECONDS, sent24, s.dailySendCap);
    if (budget <= 0) {
      report.held.push(`${companyId}/${channel}: daily cap`);
      return;
    }

    const claimed = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE comm_campaign_recipients r
      SET status = 'SENDING', "leaseUntil" = now() + (${LEASE_SECONDS} * interval '1 second'), attempts = r.attempts + 1
      WHERE r.id IN (
        SELECT r2.id FROM comm_campaign_recipients r2
        JOIN comm_campaigns c ON c.id = r2."campaignId"
        WHERE c."companyId" = ${companyId} AND c.status = 'SENDING' AND c.channel = ${channel}::"CommChannel"
          AND r2.status = 'QUEUED' AND (r2."nextAttemptAt" IS NULL OR r2."nextAttemptAt" <= now())
        ORDER BY r2."queuedAt", r2.id
        LIMIT ${budget}
        FOR UPDATE OF r2 SKIP LOCKED
      )
      RETURNING r.id`);
    report.claimed += claimed.length;
    const cache = new Map<string, TemplateContent | null>();
    for (const { id } of claimed) {
      try {
        const outcome = await this.processOne(id, s, cache);
        report[outcome]++;
      } catch (e) {
        // An unexpected error after claiming: the outcome is unknown, so flag it rather than risk a duplicate.
        this.logger.error(`Recipient ${id}: ${(e as Error).message}`);
        await this.prisma.commCampaignRecipient.updateMany({
          where: { id, status: 'SENDING' },
          data: {
            status: 'UNCERTAIN',
            lastError: `Unexpected error: ${(e as Error).message}`.slice(
              0,
              300,
            ),
          },
        });
        report.uncertain++;
      }
    }
  }

  private async skip(id: string, reason: string): Promise<'skipped'> {
    await this.prisma.commCampaignRecipient.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'SKIPPED', skipReason: reason, leaseUntil: null },
    });
    return 'skipped';
  }

  /** Content for a campaign in the person's language when a translation of the same template exists. */
  private async contentFor(
    c: CommCampaign & { template: CommTemplate | null },
    language: string,
    live: boolean,
    cache: Map<string, TemplateContent | null>,
  ): Promise<TemplateContent> {
    const key = `${c.id}:${language}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let content = await this.campaigns.contentOf(c);
    if (c.template) {
      const sibling = await this.prisma.commTemplate.findFirst({
        where: {
          companyId: c.companyId,
          key: c.template.key,
          channel: c.channel,
          language,
          isActive: true,
          ...(live && c.channel === 'WHATSAPP' ? { approval: 'APPROVED' } : {}),
        },
      });
      if (sibling)
        content = {
          subject: sibling.subject,
          bodyHtml: sibling.bodyHtml,
          bodyText: sibling.bodyText,
          variables: sibling.variables,
          whatsappTemplateName: sibling.whatsappTemplateName,
          language: sibling.language,
        };
    }
    cache.set(key, content);
    return content;
  }

  private async processOne(
    id: string,
    s: CommSettings,
    cache: Map<string, TemplateContent | null>,
  ): Promise<'sent' | 'skipped' | 'failed' | 'retried' | 'uncertain'> {
    const r = await this.prisma.commCampaignRecipient.findUnique({
      where: { id },
      include: {
        campaign: { include: { template: true } },
        contact: { include: { channels: true, subscriptions: true } },
      },
    });
    if (!r) return 'failed';
    const c = r.campaign;
    const channel = c.channel;
    const type = channel === 'EMAIL' ? 'EMAIL' : 'PHONE';

    // The campaign may have been paused or cancelled between claiming and now: hand the person back untouched.
    if (c.status !== 'SENDING') {
      await this.prisma.commCampaignRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: {
          status: c.status === 'CANCELLED' ? 'CANCELLED' : 'QUEUED',
          leaseUntil: null,
          attempts: { decrement: 1 },
        },
      });
      return 'skipped';
    }

    // Consent is decided here, with fresh data - not trusted from when the audience was chosen.
    const rows = r.contact.channels.filter((x) => x.type === type);
    const address = rows.find((x) => x.isPrimary) ?? rows[0] ?? null;
    const suppressed = address
      ? await this.consent.isSuppressed(r.companyId, channel, address.value)
      : false;
    const sub = r.contact.subscriptions.find((x) => x.channel === channel);
    const verdict = marketingEligibility({
      contactStatus: r.contact.status,
      hasAddress: !!address,
      addressInvalid: !!address?.invalid,
      suppressed,
      subscription: sub?.status ?? 'NONE',
      subscribedTopics: sub?.topics ?? [],
      topic: c.topic,
    });
    if (!verdict.eligible) return this.skip(id, verdict.reason);
    if (!address) return this.skip(id, 'NO_ADDRESS');

    if (s.testMode) {
      const allowed = new Set(
        s.testRecipients
          .map((x) =>
            channel === 'EMAIL' ? x.toLowerCase() : normalisePhone(x),
          )
          .filter(Boolean),
      );
      if (!allowed.has(address.value)) return this.skip(id, 'TEST_MODE');
    }

    const live =
      c.channel === 'EMAIL'
        ? (await this.outbound.emailHealth()).mode === 'LIVE'
        : (await this.whatsapp.activeProviderName()) === 'meta';
    const content = await this.contentFor(
      c,
      r.contact.preferredLanguage,
      live,
      cache,
    );
    const built = this.builder.build({
      channel,
      marketing: true,
      content,
      contact: {
        fullName: r.contact.fullName,
        preferenceToken: r.contact.preferenceToken,
      },
      values: (c.variables as Record<string, string> | null) ?? {},
      senderName: s.senderName,
    });
    if (built.missing.length) {
      await this.prisma.commCampaignRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastError: `Missing value for ${built.missing.join(', ')}`,
          leaseUntil: null,
        },
      });
      return 'failed';
    }

    const result =
      built.channel === 'EMAIL'
        ? await this.outbound.sendEmail({
            to: address.value,
            subject: built.subject,
            html: built.html,
            text: built.text,
            headers: built.headers,
            replyTo: s.replyTo ?? undefined,
            fromName: s.senderName,
          })
        : await this.outbound.sendWhatsAppTemplate({
            to: address.value,
            templateName: built.templateName,
            language: built.language,
            variables: built.variables,
          });

    const now = new Date();
    if (result.ok) {
      await this.prisma.commCampaignRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: {
          status: 'SENT',
          sentAt: now,
          providerMessageId: result.providerMessageId,
          simulated: result.simulated,
          leaseUntil: null,
          lastError: null,
        },
      });
      await this.prisma.commContact.update({
        where: { id: r.contactId },
        data: { lastCommunicatedAt: now },
      });
      await this.prisma.commDeliveryEvent
        .create({
          data: {
            companyId: r.companyId,
            campaignId: c.id,
            recipientId: id,
            channel,
            type: 'SENT',
            providerMessageId: result.providerMessageId,
            providerEventId: `${id}:SENT`,
            simulated: result.simulated,
            occurredAt: now,
          },
        })
        .catch(() => undefined);
      return 'sent';
    }
    if (result.uncertain) {
      await this.prisma.commCampaignRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: {
          status: 'UNCERTAIN',
          sentAt: now,
          lastError: result.error,
          leaseUntil: null,
        },
      });
      return 'uncertain';
    }
    const delay = result.retryable ? retryDelayMs(r.attempts) : null;
    if (delay !== null) {
      await this.prisma.commCampaignRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: {
          status: 'QUEUED',
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: result.error?.slice(0, 300),
          leaseUntil: null,
        },
      });
      return 'retried';
    }
    await this.prisma.commCampaignRecipient.updateMany({
      where: { id, status: 'SENDING' },
      data: {
        status: 'FAILED',
        failedAt: now,
        lastError:
          result.error?.slice(0, 300) ?? 'The provider refused the message.',
        leaseUntil: null,
      },
    });
    await this.prisma.commDeliveryEvent
      .create({
        data: {
          companyId: r.companyId,
          campaignId: c.id,
          recipientId: id,
          channel,
          type: 'FAILED',
          providerEventId: `${id}:FAILED`,
          simulated: result.simulated,
          occurredAt: now,
          detail: result.error?.slice(0, 300),
        },
      })
      .catch(() => undefined);
    return 'failed';
  }

  private async closeIfDone(campaignId: string): Promise<boolean> {
    const pending = await this.prisma.commCampaignRecipient.count({
      where: { campaignId, status: { in: ['QUEUED', 'SENDING'] } },
    });
    if (pending > 0) return false;
    const accepted = await this.prisma.commCampaignRecipient.count({
      where: {
        campaignId,
        status: { in: ['SENT', 'DELIVERED', 'READ', 'UNCERTAIN'] },
      },
    });
    const failed = await this.prisma.commCampaignRecipient.count({
      where: { campaignId, status: 'FAILED' },
    });
    const status = accepted === 0 && failed > 0 ? 'FAILED' : 'COMPLETED';
    const r = await this.prisma.commCampaign.updateMany({
      where: { id: campaignId, status: 'SENDING' },
      data: { status, completedAt: new Date() },
    });
    return r.count === 1;
  }
}
