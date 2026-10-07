import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WorkflowGraph } from './engine/graph';
import { isDue, ScheduleConfig } from './engine/schedule';
import { WorkflowEventBus } from './events/workflow-event-bus.service';
import { WorkflowDispatcherService } from './workflow-dispatcher.service';
import { LEASE_MS, WorkflowExecutorService } from './workflow-executor.service';

/** How many executions one tick will pick up. */
const BATCH = 25;

export interface TickResult {
  eventsRecovered: number;
  executionsRun: number;
  schedulesFired: number;
}

/**
 * Phase 21 — the ONE automation scheduler.
 *
 * The audit found a dozen independent @Cron jobs with no lock, so a second API instance
 * fires everything twice. This tick is safe to run on any number of instances at once
 * because every unit of work is CLAIMED atomically (a row lease via `FOR UPDATE SKIP
 * LOCKED`, or a conditional update) — two ticks can never both take the same execution
 * or the same schedule window. It does not replace the existing domain crons; new
 * automation should be a workflow, and the old reminders can migrate onto it over time.
 */
@Injectable()
export class WorkflowSchedulerService {
  private readonly logger = new Logger(WorkflowSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: WorkflowExecutorService,
    private readonly dispatcher: WorkflowDispatcherService,
    private readonly bus: WorkflowEventBus,
  ) {}

  @Cron('* * * * *')
  async scheduled(): Promise<void> {
    if (process.env.WORKFLOW_SCHEDULER_DISABLED === 'true') return;
    // Never overlap with itself in this process; across processes the row claims do the protecting.
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(
        `Scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async tick(now: Date = new Date()): Promise<TickResult> {
    const schedulesFired = await this.fireSchedules(now);
    const eventsRecovered = await this.recoverEvents(now);
    const executionsRun = await this.runDue(now);
    return { eventsRecovered, executionsRun, schedulesFired };
  }

  /** Events stored but never (successfully) dispatched — e.g. the process died between store and dispatch. */
  private async recoverEvents(now: Date): Promise<number> {
    const stale = await this.prisma.workflowEvent.findMany({
      where: {
        OR: [
          {
            status: 'PENDING',
            createdAt: { lt: new Date(now.getTime() - 15_000) },
          },
          {
            status: 'FAILED',
            processedAt: { lt: new Date(now.getTime() - 60_000) },
            createdAt: { gt: new Date(now.getTime() - 24 * 3600_000) },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const e of stale)
      await this.dispatcher
        .dispatch(e.id)
        .catch((err) =>
          this.logger.warn(
            `Recovery dispatch of ${e.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    return stale.length;
  }

  /** Claim due executions with a lease, then run each. A second tick sees the moved nextRunAt and skips them. */
  private async runDue(now: Date): Promise<number> {
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "workflow_executions"
         SET "nextRunAt" = ${lease}, "status" = 'RUNNING', "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "workflow_executions"
          WHERE "status" IN ('RUNNING', 'WAITING') AND "nextRunAt" IS NOT NULL AND "nextRunAt" <= ${now}
          ORDER BY "nextRunAt" ASC
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;
    for (const row of claimed)
      await this.executor.advance(row.id, { leased: true });
    return claimed.length;
  }

  /** Fire each schedule-triggered workflow once per window. The claim is a conditional update, so only one instance wins. */
  private async fireSchedules(now: Date): Promise<number> {
    const defs = await this.prisma.workflowDefinition.findMany({
      where: {
        status: 'ACTIVE',
        triggerEvent: { startsWith: 'schedule.' },
        activeVersionId: { not: null },
      },
      select: {
        id: true,
        companyId: true,
        branchId: true,
        triggerEvent: true,
        activeVersionId: true,
        scheduleLastFiredAt: true,
      },
    });
    let fired = 0;
    for (const d of defs) {
      const version = await this.prisma.workflowVersion.findUnique({
        where: { id: d.activeVersionId as string },
        select: { graph: true },
      });
      const trigger = (
        version?.graph as unknown as WorkflowGraph | undefined
      )?.nodes.find((n) => n.type === 'TRIGGER');
      const schedule = (
        trigger?.config as { schedule?: ScheduleConfig } | undefined
      )?.schedule;
      if (!schedule) continue;
      const { due, window } = isDue(schedule, d.scheduleLastFiredAt, now);
      if (!due) continue;
      const claim = await this.prisma.workflowDefinition.updateMany({
        where: {
          id: d.id,
          OR: [
            { scheduleLastFiredAt: null },
            { scheduleLastFiredAt: { lt: window } },
          ],
        },
        data: { scheduleLastFiredAt: window },
      });
      if (claim.count !== 1) continue; // another instance fired this window
      await this.bus.publishSafe({
        type: d.triggerEvent as string,
        source: 'scheduler',
        companyId: d.companyId,
        branchId: d.branchId,
        entityType: 'WorkflowDefinition',
        entityId: d.id,
        payload: {
          schedule: {
            window: window.toISOString(),
            frequency: schedule.frequency,
          },
        },
        dedupeKey: `schedule:${d.id}:${window.toISOString()}`,
      });
      fired += 1;
    }
    return fired;
  }
}
