import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, WorkflowEvent } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConditionError, evaluateCondition } from './engine/conditions';
import { WorkflowGraph } from './engine/graph';
import {
  ChainContext,
  executionKey,
  extendChain,
  LoopError,
} from './engine/loop-guard';
import { WORKFLOW_EVENT_PUBLISHED } from './events/workflow-event-bus.service';
import { WorkflowExecutorService } from './workflow-executor.service';
import { WorkflowRateLimiterService } from './workflow-rate-limiter.service';

/**
 * Phase 21 — turns published events into executions.
 *
 * For each event: (1) wake any execution that is waiting for it, then (2) start every
 * ACTIVE workflow of the event's own company whose trigger matches. Starting is idempotent
 * (one execution per workflow per event, enforced by a unique key), so an event dispatched
 * twice — a retry, a replay, two instances — never runs a workflow twice.
 */
@Injectable()
export class WorkflowDispatcherService {
  private readonly logger = new Logger(WorkflowDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: WorkflowExecutorService,
    private readonly rate: WorkflowRateLimiterService,
    private readonly audit: AuditService,
  ) {}

  @OnEvent(WORKFLOW_EVENT_PUBLISHED, { async: true })
  async onPublished(payload: { eventId: string }): Promise<void> {
    await this.dispatch(payload.eventId).catch((e) =>
      this.logger.error(
        `Dispatch failed for ${payload.eventId}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  /** Safe to call repeatedly for the same event. */
  async dispatch(eventId: string): Promise<{ started: number; woken: number }> {
    const ev = await this.prisma.workflowEvent.findUnique({
      where: { id: eventId },
    });
    if (!ev || ev.status === 'PROCESSED') return { started: 0, woken: 0 };

    let started = 0;
    let woken = 0;
    const errors: string[] = [];

    // Events with no company belong to no tenant's workflow; they are recorded and nothing more.
    if (ev.companyId) {
      try {
        woken = await this.wake(ev);
      } catch (e) {
        errors.push(`wake: ${e instanceof Error ? e.message : String(e)}`);
      }

      const defs = await this.prisma.workflowDefinition.findMany({
        where: {
          companyId: ev.companyId,
          status: 'ACTIVE',
          triggerEvent: ev.type,
          OR: [
            { branchId: null },
            { branchId: ev.branchId ?? '__no_branch__' },
          ],
        },
        select: { id: true, name: true, branchId: true, activeVersionId: true },
      });
      for (const def of defs) {
        try {
          if (await this.start(def, ev)) started += 1;
        } catch (e) {
          errors.push(
            `${def.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    await this.prisma.workflowEvent.update({
      where: { id: ev.id },
      data:
        errors.length === 0
          ? { status: 'PROCESSED', processedAt: new Date(), error: null }
          : {
              status: 'FAILED',
              processedAt: new Date(),
              error: errors.join('; ').slice(0, 500),
            },
    });
    return { started, woken };
  }

  /** Executions waiting for THIS kind of event, in THIS company, about THIS entity (when both name one). */
  private async wake(ev: WorkflowEvent): Promise<number> {
    const waiting = await this.prisma.workflowExecution.findMany({
      where: {
        companyId: ev.companyId as string,
        status: 'WAITING',
        waitingFor: { path: ['event'], equals: ev.type },
      },
      select: { id: true, entityId: true, waitingFor: true },
      take: 200,
    });
    let n = 0;
    for (const w of waiting) {
      if (w.entityId && ev.entityId && w.entityId !== ev.entityId) continue;
      if (w.entityId && !ev.entityId) continue;
      const claimed = await this.prisma.workflowExecution.updateMany({
        where: { id: w.id, status: 'WAITING' },
        data: {
          waitingFor: {
            ...(w.waitingFor as Record<string, unknown>),
            satisfiedBy: ev.id,
          },
          nextRunAt: new Date(),
        },
      });
      if (claimed.count === 1) {
        n += 1;
        await this.executor.advance(w.id);
      }
    }
    return n;
  }

  private async start(
    def: { id: string; name: string; activeVersionId: string | null },
    ev: WorkflowEvent,
  ): Promise<boolean> {
    if (!def.activeVersionId) return false;
    const version = await this.prisma.workflowVersion.findUnique({
      where: { id: def.activeVersionId },
    });
    if (!version) return false;
    const graph = version.graph as unknown as WorkflowGraph;
    const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
    if (!trigger) return false;

    const context = this.buildContext(ev);
    const condition = (trigger.config as { condition?: unknown } | undefined)
      ?.condition;
    if (condition) {
      try {
        if (!evaluateCondition(condition as never, context).result)
          return false;
      } catch (e) {
        if (e instanceof ConditionError) {
          this.logger.warn(
            `Workflow ${def.id}: trigger condition is invalid and was skipped: ${e.message}`,
          );
          return false;
        }
        throw e;
      }
    }

    const key = executionKey(def.id, ev.id);
    const baseData = {
      workflowId: def.id,
      versionId: version.id,
      versionNo: version.version,
      companyId: ev.companyId as string,
      branchId: ev.branchId,
      eventId: ev.id,
      executionKey: key,
      mode: 'LIVE' as const,
      context: context as Prisma.InputJsonValue,
      correlationId: ev.correlationId,
      entityType: ev.entityType,
      entityId: ev.entityId,
      currentNodeId: trigger.id,
    };

    // Loop protection: stop A → B → A and runaway cascades, and leave a visible record.
    let chain: ChainContext;
    try {
      chain = extendChain(ev.chain as unknown as ChainContext, def.id, ev.id);
    } catch (e) {
      if (e instanceof LoopError) {
        await this.recordStopped(
          baseData,
          ev.chain as Prisma.InputJsonValue,
          `LOOP_${e.reason}`,
          e.message,
        );
        return false;
      }
      throw e;
    }

    // Execution-rate protection: defer rather than drop.
    const r = await this.rate.consume(
      ev.companyId as string,
      'executions.minute',
    );
    const deferred = !r.allowed;

    try {
      const ex = await this.prisma.workflowExecution.create({
        data: {
          ...baseData,
          chain: chain as unknown as Prisma.InputJsonValue,
          status: deferred ? 'WAITING' : 'RUNNING',
          nextRunAt: deferred ? new Date(Date.now() + r.retryAfterMs) : null,
          waitingFor: deferred
            ? {
                type: 'RATE_LIMIT',
                limit: 'executions.minute',
              }
            : undefined,
        },
      });
      await this.audit
        .record({
          action: 'workflow.execution_started',
          entityType: 'WorkflowExecution',
          entityId: ex.id,
          companyId: ev.companyId ?? undefined,
          branchId: ev.branchId ?? undefined,
          metadata: {
            workflowId: def.id,
            version: version.version,
            eventId: ev.id,
            eventType: ev.type,
            deferred,
            correlationId: ev.correlationId,
          },
        })
        .catch(() => undefined);
      if (!deferred) await this.executor.advance(ex.id);
      return true;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return false; // this event already started this workflow
      throw e;
    }
  }

  /** The context conditions and templates read: the payload at top level, plus a reserved `event` block. */
  buildContext(
    ev: Pick<
      WorkflowEvent,
      | 'id'
      | 'type'
      | 'entityType'
      | 'entityId'
      | 'occurredAt'
      | 'payload'
      | 'correlationId'
    >,
  ): Record<string, unknown> {
    return {
      ...(ev.payload as Record<string, unknown>),
      event: {
        id: ev.id,
        type: ev.type,
        entityType: ev.entityType ?? null,
        entityId: ev.entityId ?? null,
        occurredAt: ev.occurredAt.toISOString(),
        correlationId: ev.correlationId,
      },
      steps: {},
    };
  }

  /** A run stopped before it began (loop guard): kept as a dead-lettered execution so it is never silent. */
  private async recordStopped(
    base: Omit<Prisma.WorkflowExecutionUncheckedCreateInput, 'chain'>,
    chain: Prisma.InputJsonValue,
    reason: string,
    message: string,
  ): Promise<void> {
    try {
      const ex = await this.prisma.workflowExecution.create({
        data: {
          ...base,
          chain,
          status: 'DEAD_LETTERED',
          error: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      await this.prisma.workflowDeadLetter.create({
        data: {
          executionId: ex.id,
          nodeId: null,
          workflowId: base.workflowId,
          companyId: base.companyId,
          reason,
          error: message.slice(0, 1000),
          correlationId: base.correlationId,
        },
      });
      await this.audit
        .record({
          action: 'workflow.loop_prevented',
          entityType: 'WorkflowExecution',
          entityId: ex.id,
          companyId: base.companyId,
          metadata: { reason, workflowId: base.workflowId },
        })
        .catch(() => undefined);
    } catch (e) {
      if (!(
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      ))
        throw e;
    }
  }
}
