import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AiAnalyticsService } from '../../ai/ai-analytics.service';
import { AiMemoryService } from './memory.service';
import { AiRecommendationsService } from './recommendations.service';
import {
  OperationsScannerService,
  ScanReport,
} from './operations-scanner.service';

/**
 * Daily operations: scan every active company, build the briefing, purge expired memory. Idempotent end to
 * end — findings are keyed (no duplicate tasks day after day) and the briefing is one row per company per
 * date — so running it twice, or after a crash, is safe. Disable with AI_DAILY_OPS_DISABLED=true.
 */
@Injectable()
export class DailyOperationsService {
  private readonly logger = new Logger(DailyOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: OperationsScannerService,
    private readonly recs: AiRecommendationsService,
    private readonly analytics: AiAnalyticsService,
    private readonly memory: AiMemoryService,
  ) {}

  @Cron('30 5 * * *')
  async scheduled(): Promise<void> {
    if (
      process.env.AI_DAILY_OPS_DISABLED === 'true' ||
      process.env.WORKFLOW_SCHEDULER_DISABLED === 'true'
    )
      return;
    try {
      await this.runAll();
    } catch (err) {
      this.logger.error(
        `Daily AI operations failed: ${(err as Error).message}`,
      );
    }
  }

  async runAll() {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const results: {
      companyId: string;
      scans: ScanReport[];
      briefingId: string;
    }[] = [];
    for (const c of companies) results.push(await this.runForCompany(c.id));
    await this.memory.purgeExpired();
    // Retention: closed conversations are kept 180 days (their messages go with them), then deleted.
    await this.prisma.aiConversation.deleteMany({
      where: {
        status: 'CLOSED',
        closedAt: { lt: new Date(Date.now() - 180 * 86_400_000) },
      },
    });
    return results;
  }

  async runForCompany(companyId: string) {
    const scans = await this.scanner.scanCompany(companyId);
    const briefing = await this.briefing(companyId);
    return { companyId, scans, briefingId: briefing.id };
  }

  /** The daily briefing: every figure carries the source it came from; recommendations are the queue's evidence-backed items. */
  async briefing(companyId: string, date = new Date()) {
    const day = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const queue = await this.recs.list(companyId, {}, 100);
    const by = (kind: string) => queue.filter((r) => r.kind === kind).length;
    let kpi: { summary: string; data: Record<string, unknown> } | null = null;
    try {
      kpi = await this.analytics.execute(
        'executive_kpis',
        { days: 1 },
        companyId,
        {
          sub: 'system',
          type: 'STAFF',
          roles: [],
          permissions: [],
          companyId,
          sessionId: null,
        } as never,
      );
    } catch (err) {
      this.logger.warn(`Briefing KPIs unavailable: ${(err as Error).message}`);
    }
    const unpaid = await this.prisma.invoice.count({
      where: {
        customer: { companyId },
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      },
    });
    const failedPayments = await this.prisma.paymentIntent.count({
      where: {
        customer: { companyId },
        status: 'FAILED',
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    const top = queue.slice(0, 5);
    const content = {
      date: day.toISOString().slice(0, 10),
      figures: [
        {
          label: 'Revenue and bookings (last 24h)',
          value: kpi?.summary ?? 'Not available',
          source: 'Analytics: executive_kpis',
          ok: !!kpi,
        },
        {
          label: 'Invoices awaiting payment',
          value: unpaid,
          source: 'Finance ledger',
        },
        {
          label: 'Failed online payments (24h)',
          value: failedPayments,
          source: 'Payment intents',
        },
        {
          label: 'Visa applications needing action',
          value: by('VISA_DOCUMENT_MISSING') + by('VISA_DELAYED'),
          source: 'AI visa scan',
        },
        {
          label: 'Groups needing attention',
          value: by('GROUP_NOT_READY'),
          source: 'Hajj/Umrah readiness',
        },
        {
          label: 'Supplier issues',
          value: by('CONTRACT_EXPIRING') + by('PROVIDER_FAILURES'),
          source: 'AI supplier scan',
        },
        {
          label: 'Critical operational alerts',
          value: queue.filter((r) => r.severity === 'CRITICAL').length,
          source: 'AI exception queue',
        },
      ],
      recommendedActions: top.map((r) => ({
        id: r.id,
        severity: r.severity,
        title: r.title,
        why: r.reason,
        confidence: r.confidence,
        evidence: r.evidence,
      })),
      note: 'Every item above comes from a recorded source; nothing here is estimated by a model.',
    };
    return this.prisma.aiBriefing.upsert({
      where: { companyId_businessDate: { companyId, businessDate: day } },
      update: { content: content },
      create: {
        companyId,
        businessDate: day,
        content: content,
      },
    });
  }

  latestBriefing(companyId: string) {
    return this.prisma.aiBriefing.findFirst({
      where: { companyId },
      orderBy: { businessDate: 'desc' },
    });
  }
}
