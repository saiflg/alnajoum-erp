import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DAY = 24 * 60 * 60 * 1000;

export interface RetentionRule {
  key: string;
  description: string;
  days: number;
  /** Count what is past retention (dry run). */
  count: (cutoff: Date) => Promise<number>;
  /** Delete what is past retention. */
  purge: (cutoff: Date) => Promise<number>;
}

/**
 * Data retention (Phase 22 S-38). Operational data that has no ongoing purpose is deleted on a schedule;
 * the policy is explicit and inspectable (GET /security/retention shows what is due) and a run reports what
 * it removed.
 *
 * Deliberately NOT purged here: audit logs (they are the evidence), financial records (invoices, payments,
 * journal entries - kept for accounting/tax), customer and booking records (removed only through an
 * erasure request, which anonymises them).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private days(name: string, fallback: number): number {
    const v = Number(process.env[name]);
    return Number.isInteger(v) && v > 0 ? v : fallback;
  }

  rules(): RetentionRule[] {
    const p = this.prisma;
    return [
      {
        key: 'refresh_tokens',
        description: 'Expired or revoked sign-in sessions',
        days: this.days('RETENTION_SESSIONS_DAYS', 30),
        count: (c) =>
          p.refreshToken.count({
            where: { OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }] },
          }),
        purge: async (c) =>
          (
            await p.refreshToken.deleteMany({
              where: {
                OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }],
              },
            })
          ).count,
      },
      {
        key: 'password_reset_tokens',
        description: 'Used or expired password-reset tokens',
        days: this.days('RETENTION_RESET_TOKENS_DAYS', 7),
        count: (c) =>
          p.passwordResetToken.count({
            where: { OR: [{ expiresAt: { lt: c } }, { usedAt: { lt: c } }] },
          }),
        purge: async (c) =>
          (
            await p.passwordResetToken.deleteMany({
              where: { OR: [{ expiresAt: { lt: c } }, { usedAt: { lt: c } }] },
            })
          ).count,
      },
      {
        key: 'notifications',
        description: 'Sent-message log (emails, SMS, WhatsApp, push)',
        days: this.days('RETENTION_NOTIFICATIONS_DAYS', 365),
        count: (c) => p.notification.count({ where: { createdAt: { lt: c } } }),
        purge: async (c) =>
          (await p.notification.deleteMany({ where: { createdAt: { lt: c } } }))
            .count,
      },
      {
        key: 'whatsapp_webhook_events',
        description: 'Processed inbound WhatsApp webhook records',
        days: this.days('RETENTION_WEBHOOK_EVENTS_DAYS', 90),
        count: (c) =>
          p.whatsAppWebhookEvent.count({
            where: { status: 'PROCESSED', receivedAt: { lt: c } },
          }),
        purge: async (c) =>
          (
            await p.whatsAppWebhookEvent.deleteMany({
              where: { status: 'PROCESSED', receivedAt: { lt: c } },
            })
          ).count,
      },
      {
        key: 'workflow_events',
        description: 'Processed workflow engine events',
        days: this.days('RETENTION_WORKFLOW_EVENTS_DAYS', 180),
        count: (c) =>
          p.workflowEvent.count({
            where: { status: 'PROCESSED', createdAt: { lt: c } },
          }),
        purge: async (c) =>
          (
            await p.workflowEvent.deleteMany({
              where: { status: 'PROCESSED', createdAt: { lt: c } },
            })
          ).count,
      },
    ];
  }

  /** What is past retention right now, without deleting anything. */
  async preview() {
    return Promise.all(
      this.rules().map(async (rule) => {
        const cutoff = new Date(Date.now() - rule.days * DAY);
        return {
          key: rule.key,
          description: rule.description,
          retentionDays: rule.days,
          cutoff,
          due: await rule.count(cutoff),
        };
      }),
    );
  }

  async run(actorIdentityId?: string) {
    const results: Array<{ key: string; removed: number }> = [];
    for (const rule of this.rules()) {
      const removed = await rule.purge(new Date(Date.now() - rule.days * DAY));
      results.push({ key: rule.key, removed });
    }
    await this.audit.record({
      identityId: actorIdentityId,
      action: 'privacy.retention_run',
      entityType: 'Retention',
      metadata: { results },
    });
    this.logger.log(`Retention run: ${JSON.stringify(results)}`);
    return results;
  }

  @Cron('30 3 * * *')
  async scheduled(): Promise<void> {
    if (process.env.RETENTION_DISABLED === 'true') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `Scheduled retention run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
