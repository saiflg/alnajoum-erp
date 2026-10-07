import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  WorkflowExecution,
  WorkflowExecutionStep,
  WorkflowVersion,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../governance/approvals.service';
import { ActionContext } from './actions/action.types';
import { ActionRegistryService } from './actions/action-registry.service';
import {
  ConditionError,
  evaluateCondition,
  readPath,
} from './engine/conditions';
import {
  EdgeLabel,
  nextNode,
  WorkflowGraph,
  WorkflowNode,
} from './engine/graph';
import { ChainContext } from './engine/loop-guard';
import { actionKey } from './engine/loop-guard';
import { jsonSize, redact } from './engine/redact';
import {
  ActionError,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  RetryPolicy,
} from './engine/retry';
import { renderTemplate, TemplateError } from './engine/template';
import { WorkflowRateLimiterService } from './workflow-rate-limiter.service';

/** A running execution holds a lease this long; if the process dies, the scheduler picks it up when the lease lapses. */
export const LEASE_MS = 2 * 60_000;
/** Steps one pass may execute before yielding, so a long workflow cannot monopolise a worker. */
const MAX_STEPS_PER_PASS = 25;
const APPROVAL_POLL_MS = 60_000;
const MAX_CONTEXT_BYTES = 256 * 1024;

type Ctx = Record<string, unknown>;

type Outcome =
  | { kind: 'next'; label: EdgeLabel; context: Ctx }
  | {
      kind: 'wait';
      until: Date;
      waitingFor: Record<string, unknown>;
      context: Ctx;
    }
  | { kind: 'end'; context: Ctx }
  | { kind: 'fail'; code: string; message: string; context: Ctx };

interface WorkflowInfo {
  id: string;
  name: string;
  ownerIdentityId: string | null;
  createdByIdentityId: string | null;
}

/**
 * Phase 21 — runs a workflow execution, step by step.
 *
 * Durable by construction: every step is written to the database BEFORE the engine moves
 * on, and a resumed execution consults those rows, so a restart neither repeats a finished
 * step nor loses its place. Side effects are protected twice — by the step's own state (a
 * SUCCEEDED step is never re-run) and by an idempotency key passed to the action. An
 * execution always runs the graph of the version it started under.
 */
@Injectable()
export class WorkflowExecutorService {
  private readonly logger = new Logger(WorkflowExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ActionRegistryService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly rate: WorkflowRateLimiterService,
  ) {}

  /**
   * Run an execution until it finishes, waits or yields. `leased` is true when the scheduler
   * has already claimed it (moving nextRunAt forward); otherwise the claim happens here, and
   * losing it means another worker has it — which is fine.
   */
  async advance(
    executionId: string,
    opts: { leased?: boolean } = {},
  ): Promise<void> {
    const now = new Date();
    if (!opts.leased) {
      const claimed = await this.prisma.workflowExecution.updateMany({
        where: {
          id: executionId,
          status: { in: ['RUNNING', 'WAITING'] },
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        data: {
          status: 'RUNNING',
          nextRunAt: new Date(now.getTime() + LEASE_MS),
        },
      });
      if (claimed.count === 0) return;
    }

    const ex = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            ownerIdentityId: true,
            createdByIdentityId: true,
          },
        },
      },
    });
    if (!ex || (ex.status !== 'RUNNING' && ex.status !== 'WAITING')) return;
    const version = await this.prisma.workflowVersion.findUnique({
      where: { id: ex.versionId },
    });
    if (!version) {
      await this.deadLetter(
        ex,
        ex.currentNodeId,
        'VERSION_MISSING',
        'The workflow version this execution started under no longer exists',
      );
      return;
    }

    try {
      await this.run(ex, ex.workflow, version);
    } catch (e) {
      // An engine fault (not an action failure): keep the execution alive and look again shortly.
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Execution ${ex.id} hit an engine error: ${message}`);
      await this.prisma.workflowExecution
        .update({
          where: { id: ex.id },
          data: {
            status: 'WAITING',
            nextRunAt: new Date(Date.now() + 60_000),
            error: message.slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ the loop

  private async run(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    version: WorkflowVersion,
  ): Promise<void> {
    const graph = version.graph as unknown as WorkflowGraph;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    let nodeId =
      ex.currentNodeId ??
      graph.nodes.find((n) => n.type === 'TRIGGER')?.id ??
      null;
    let context = ex.context as Ctx;
    let waitingFor = ex.waitingFor as Record<string, unknown> | null;

    for (let i = 0; i < MAX_STEPS_PER_PASS; i++) {
      const node = nodeId ? byId.get(nodeId) : undefined;
      if (!node) {
        await this.deadLetter(
          ex,
          nodeId,
          'GRAPH',
          `Step "${nodeId}" does not exist in version ${version.version}`,
        );
        return;
      }

      const out = await this.runNode(
        ex,
        wf,
        version,
        node,
        graph,
        context,
        waitingFor,
      );
      context = out.context;

      if (jsonSize(context) > MAX_CONTEXT_BYTES) {
        await this.deadLetter(
          ex,
          node.id,
          'CONTEXT_TOO_LARGE',
          'The execution context grew past its size limit',
        );
        return;
      }
      if (out.kind === 'wait') {
        await this.prisma.workflowExecution.update({
          where: { id: ex.id },
          data: {
            status: 'WAITING',
            currentNodeId: node.id,
            context: context as Prisma.InputJsonValue,
            waitingFor: out.waitingFor as Prisma.InputJsonValue,
            nextRunAt: out.until,
            error: null,
          },
        });
        return;
      }
      if (out.kind === 'fail') {
        await this.prisma.workflowExecution.update({
          where: { id: ex.id },
          data: { context: context as Prisma.InputJsonValue },
        });
        await this.deadLetter(ex, node.id, out.code, out.message);
        return;
      }
      if (out.kind === 'end') {
        await this.prisma.workflowExecution.update({
          where: { id: ex.id },
          data: {
            status: 'COMPLETED',
            currentNodeId: node.id,
            context: context as Prisma.InputJsonValue,
            waitingFor: Prisma.DbNull,
            nextRunAt: null,
            finishedAt: new Date(),
            error: null,
          },
        });
        await this.safeAudit(ex, 'workflow.execution_completed', {
          workflowId: wf.id,
          mode: ex.mode,
        });
        return;
      }

      const to = nextNode(graph, node.id, out.label);
      if (!to) {
        await this.deadLetter(
          ex,
          node.id,
          'NO_ROUTE',
          `Step "${node.id}" has no "${out.label}" connection`,
        );
        return;
      }
      nodeId = to;
      waitingFor = null;
      await this.prisma.workflowExecution.update({
        where: { id: ex.id },
        data: {
          currentNodeId: to,
          context: context as Prisma.InputJsonValue,
          waitingFor: Prisma.DbNull,
          nextRunAt: new Date(Date.now() + LEASE_MS),
          status: 'RUNNING',
          error: null,
        },
      });
    }

    // Used the whole step budget: yield, and let the scheduler continue it.
    await this.prisma.workflowExecution.update({
      where: { id: ex.id },
      data: { status: 'WAITING', nextRunAt: new Date() },
    });
  }

  // ------------------------------------------------------------------- nodes

  private async runNode(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    version: WorkflowVersion,
    node: WorkflowNode,
    graph: WorkflowGraph,
    context: Ctx,
    waitingFor: Record<string, unknown> | null,
  ): Promise<Outcome> {
    const step = await this.prisma.workflowExecutionStep.findUnique({
      where: { executionId_nodeId: { executionId: ex.id, nodeId: node.id } },
    });
    const cfg = node.config ?? {};
    const testMode = ex.mode === 'TEST';

    switch (node.type) {
      case 'TRIGGER':
        await this.saveStep(ex, node, {
          status: 'SUCCEEDED',
          finished: true,
          attempts: 1,
        });
        return { kind: 'next', label: 'default', context };

      case 'CONDITION': {
        try {
          const r = evaluateCondition(cfg.condition as never, context);
          await this.saveStep(ex, node, {
            status: 'SUCCEEDED',
            finished: true,
            attempts: 1,
            trace: r.trace as unknown as Prisma.InputJsonValue,
            output: { result: r.result },
          });
          return { kind: 'next', label: r.result ? 'true' : 'false', context };
        } catch (e) {
          const message =
            e instanceof ConditionError
              ? e.message
              : 'The condition could not be evaluated';
          await this.saveStep(ex, node, {
            status: 'FAILED',
            finished: true,
            attempts: 1,
            error: message,
          });
          return { kind: 'fail', code: 'CONDITION_INVALID', message, context };
        }
      }

      case 'ACTION':
        return this.runAction(
          ex,
          wf,
          version,
          node,
          context,
          step,
          String(cfg.action),
          cfg,
          '',
        );

      case 'DELAY': {
        if (step?.status === 'SUCCEEDED')
          return { kind: 'next', label: 'default', context };
        if (step?.status === 'WAITING' || testMode) {
          await this.saveStep(ex, node, {
            status: 'SUCCEEDED',
            finished: true,
            attempts: 1,
            output: { skipped: testMode },
          });
          return { kind: 'next', label: 'default', context };
        }
        const until = new Date(Date.now() + Number(cfg.durationMs));
        await this.saveStep(ex, node, {
          status: 'WAITING',
          attempts: 1,
          output: { resumeAt: until.toISOString() },
        });
        return { kind: 'wait', until, waitingFor: { type: 'DELAY' }, context };
      }

      case 'WAIT': {
        if (step?.status === 'SUCCEEDED')
          return { kind: 'next', label: 'default', context };
        if (testMode) {
          await this.saveStep(ex, node, {
            status: 'SUCCEEDED',
            finished: true,
            attempts: 1,
            output: { assumedSatisfied: true },
            mocked: true,
          });
          return { kind: 'next', label: 'default', context };
        }
        if (!step) {
          const deadline = new Date(Date.now() + Number(cfg.timeoutMs));
          await this.saveStep(ex, node, {
            status: 'WAITING',
            attempts: 1,
            output: { deadline: deadline.toISOString(), waitingFor: cfg.until },
          });
          return {
            kind: 'wait',
            until: deadline,
            waitingFor: {
              type: 'EVENT',
              event: cfg.until,
              deadline: deadline.toISOString(),
            },
            context,
          };
        }
        // Resumed: either the awaited event arrived, or the deadline passed.
        if (waitingFor?.satisfiedBy) {
          await this.saveStep(ex, node, {
            status: 'SUCCEEDED',
            finished: true,
            attempts: 1,
            output: { satisfiedBy: waitingFor.satisfiedBy },
          });
          return {
            kind: 'next',
            label: 'default',
            context: {
              ...context,
              steps: {
                ...(context.steps as Ctx | undefined),
                [node.id]: { satisfiedBy: waitingFor.satisfiedBy },
              },
            },
          };
        }
        if (nextNode(graph, node.id, 'timeout')) {
          await this.saveStep(ex, node, {
            status: 'SUCCEEDED',
            finished: true,
            attempts: 1,
            output: { timedOut: true },
          });
          return { kind: 'next', label: 'timeout', context };
        }
        await this.saveStep(ex, node, {
          status: 'FAILED',
          finished: true,
          attempts: 1,
          error: 'Timed out waiting',
        });
        return {
          kind: 'fail',
          code: 'WAIT_TIMEOUT',
          message: `Timed out waiting for ${String(cfg.until)}`,
          context,
        };
      }

      case 'APPROVAL':
        return this.runApproval(ex, wf, node, graph, context, step);

      case 'ESCALATION':
        return this.runEscalation(
          ex,
          wf,
          version,
          node,
          context,
          step,
          waitingFor,
        );

      case 'END':
        await this.saveStep(ex, node, {
          status: 'SUCCEEDED',
          finished: true,
          attempts: 1,
        });
        return { kind: 'end', context };
    }
  }

  // ----------------------------------------------------------------- actions

  private buildActionContext(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    node: WorkflowNode,
    config: Record<string, unknown>,
    idempotencyKey: string,
    context: Ctx,
  ): ActionContext {
    return {
      executionId: ex.id,
      nodeId: node.id,
      idempotencyKey,
      mode: ex.mode,
      companyId: ex.companyId,
      branchId: ex.branchId,
      context,
      config,
      chain: ex.chain as unknown as ChainContext,
      correlationId: ex.correlationId,
      ownerIdentityId: wf.ownerIdentityId ?? wf.createdByIdentityId,
      render: (t: string) => {
        try {
          return renderTemplate(t, context);
        } catch (e) {
          if (e instanceof TemplateError)
            throw new ActionError(e.message, 'PERMANENT', 'TEMPLATE');
          throw e;
        }
      },
    };
  }

  /** Runs one action with retry/idempotency/rate-limit handling. Shared by ACTION steps and escalation levels. */
  private async runAction(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    version: WorkflowVersion,
    node: WorkflowNode,
    context: Ctx,
    step: WorkflowExecutionStep | null,
    key: string,
    config: Record<string, unknown>,
    keySuffix: string,
  ): Promise<Outcome> {
    if (step?.status === 'SUCCEEDED' && !keySuffix) {
      // Finished in an earlier pass (a crash after the step but before moving on): never run it twice.
      return { kind: 'next', label: 'default', context };
    }
    const action = this.registry.get(key);
    if (!action) {
      await this.saveStep(ex, node, {
        status: 'FAILED',
        finished: true,
        attempts: 1,
        error: `Unknown action "${key}"`,
      });
      return {
        kind: 'fail',
        code: 'UNKNOWN_ACTION',
        message: `"${key}" is not an available action`,
        context,
      };
    }

    const idKey = actionKey(ex.id, node.id) + keySuffix;
    const policy =
      (version.retryPolicy as unknown as RetryPolicy | null) ??
      DEFAULT_RETRY_POLICY;

    // Rate limits apply to live side effects. A throttled step is deferred, never dropped, and uses no attempt.
    if (ex.mode === 'LIVE') {
      const limitKey =
        action.sideEffect === 'NOTIFY'
          ? 'messages.minute'
          : action.sideEffect === 'FINANCIAL'
            ? 'payment.attempts.hour'
            : null;
      if (limitKey) {
        const r = await this.rate.consume(ex.companyId, limitKey);
        if (!r.allowed) {
          return {
            kind: 'wait',
            until: new Date(Date.now() + r.retryAfterMs),
            waitingFor: { type: 'RATE_LIMIT', limit: limitKey },
            context,
          };
        }
      }
    }

    const attempts = (step?.attempts ?? 0) + 1;
    await this.saveStep(ex, node, {
      status: 'RUNNING',
      attempts,
      input: redact(config) as Prisma.InputJsonValue,
      idempotencyKey: idKey,
    });
    const actx = this.buildActionContext(ex, wf, node, config, idKey, context);

    try {
      const output =
        ex.mode === 'TEST' ? action.mock(actx) : await action.run(actx);
      const safe = redact(output);
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts,
        output: safe,
        mocked: ex.mode === 'TEST',
        idempotencyKey: idKey,
      });
      if (ex.mode === 'LIVE')
        await this.safeAudit(ex, 'workflow.action_executed', {
          workflowId: wf.id,
          nodeId: node.id,
          action: key,
          sideEffect: action.sideEffect,
        });
      return {
        kind: 'next',
        label: 'default',
        context: {
          ...context,
          steps: { ...(context.steps as Ctx | undefined), [node.id]: safe },
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const decision = decideRetry({
        policy,
        attemptsMade: attempts,
        error: e,
        sideEffect: action.sideEffect,
      });
      if (decision.retry) {
        await this.saveStep(ex, node, {
          status: 'RETRYING',
          attempts,
          error: message,
          idempotencyKey: idKey,
        });
        return {
          kind: 'wait',
          until: new Date(Date.now() + (decision.delayMs ?? 60_000)),
          waitingFor: {
            type: 'RETRY',
            nodeId: node.id,
            attempt: attempts,
            reason: decision.reason,
          },
          context,
        };
      }
      await this.saveStep(ex, node, {
        status: 'FAILED',
        finished: true,
        attempts,
        error: message,
        idempotencyKey: idKey,
      });
      return {
        kind: 'fail',
        code:
          e instanceof ActionError
            ? (e.code ?? 'ACTION_FAILED')
            : 'ACTION_FAILED',
        message: `${message} (${decision.reason})`,
        context,
      };
    }
  }

  // ---------------------------------------------------------------- approval

  private async runApproval(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    node: WorkflowNode,
    graph: WorkflowGraph,
    context: Ctx,
    step: WorkflowExecutionStep | null,
  ): Promise<Outcome> {
    const cfg = node.config ?? {};
    if (step?.status === 'SUCCEEDED') {
      const approved =
        (step.output as { decision?: string } | null)?.decision !== 'REJECTED';
      return {
        kind: 'next',
        label: approved ? 'approved' : 'rejected',
        context,
      };
    }
    if (ex.mode === 'TEST') {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: { decision: 'APPROVED', assumed: true },
        mocked: true,
      });
      return { kind: 'next', label: 'approved', context };
    }

    if (!step) {
      const requester = wf.ownerIdentityId ?? wf.createdByIdentityId;
      if (!requester) {
        await this.saveStep(ex, node, {
          status: 'FAILED',
          finished: true,
          attempts: 1,
          error: 'No owner',
        });
        return {
          kind: 'fail',
          code: 'NO_REQUESTER',
          message: 'The workflow has no owner to raise the approval request as',
          context,
        };
      }
      const amountRaw =
        typeof cfg.amountField === 'string'
          ? readPath(context, cfg.amountField)
          : undefined;
      const request = await this.approvals.createRequest({
        type: `WORKFLOW:${String(cfg.approvalType)}`,
        amount: typeof amountRaw === 'number' ? amountRaw : undefined,
        currency:
          typeof cfg.currencyField === 'string'
            ? (readPath(context, cfg.currencyField) as string | undefined)
            : undefined,
        entityType: 'WorkflowExecution',
        entityId: ex.id,
        requestedByIdentityId: requester,
        reason:
          typeof cfg.reason === 'string'
            ? safeRender(cfg.reason, context)
            : `Approval requested by workflow "${wf.name}"`,
        companyId: ex.companyId,
      });
      const deadline = new Date(Date.now() + Number(cfg.timeoutMs));
      await this.saveStep(ex, node, {
        status: 'WAITING',
        attempts: 1,
        output: {
          approvalRequestId: request.id,
          deadline: deadline.toISOString(),
        },
      });
      return {
        kind: 'wait',
        until: new Date(
          Math.min(deadline.getTime(), Date.now() + APPROVAL_POLL_MS),
        ),
        waitingFor: {
          type: 'APPROVAL',
          approvalRequestId: request.id,
          deadline: deadline.toISOString(),
        },
        context,
      };
    }

    // Polling: the existing approval engine has no completion callback, so look at its state.
    const info = step.output as { approvalRequestId: string; deadline: string };
    const req = await this.prisma.approvalRequest.findFirst({
      where: { id: info.approvalRequestId, companyId: ex.companyId },
      select: { status: true },
    });
    if (req?.status === 'APPROVED') {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: { ...info, decision: 'APPROVED' },
      });
      return { kind: 'next', label: 'approved', context };
    }
    if (req?.status === 'REJECTED') {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: { ...info, decision: 'REJECTED' },
      });
      return { kind: 'next', label: 'rejected', context };
    }
    const deadline = new Date(info.deadline);
    if (Date.now() >= deadline.getTime()) {
      if (nextNode(graph, node.id, 'timeout')) {
        await this.saveStep(ex, node, {
          status: 'SUCCEEDED',
          finished: true,
          attempts: 1,
          output: { ...info, decision: 'TIMED_OUT' },
        });
        return { kind: 'next', label: 'timeout', context };
      }
      await this.saveStep(ex, node, {
        status: 'FAILED',
        finished: true,
        attempts: 1,
        error: 'Approval timed out',
      });
      return {
        kind: 'fail',
        code: 'APPROVAL_TIMEOUT',
        message: 'The approval was not decided in time',
        context,
      };
    }
    return {
      kind: 'wait',
      until: new Date(
        Math.min(deadline.getTime(), Date.now() + APPROVAL_POLL_MS),
      ),
      waitingFor: {
        type: 'APPROVAL',
        approvalRequestId: info.approvalRequestId,
        deadline: info.deadline,
      },
      context,
    };
  }

  // -------------------------------------------------------------- escalation

  /**
   * Escalation fires its levels at increasing times after the step began. An optional
   * `stopOnEvent` (e.g. the ticket being resolved) ends it early. State lives in the step row.
   */
  private async runEscalation(
    ex: WorkflowExecution,
    wf: WorkflowInfo,
    version: WorkflowVersion,
    node: WorkflowNode,
    context: Ctx,
    step: WorkflowExecutionStep | null,
    waitingFor: Record<string, unknown> | null,
  ): Promise<Outcome> {
    const cfg = node.config ?? {};
    const levels =
      (cfg.steps as {
        afterMs: number;
        action: string;
        config?: Record<string, unknown>;
      }[]) ?? [];
    if (step?.status === 'SUCCEEDED')
      return { kind: 'next', label: 'default', context };

    const state =
      (step?.output as {
        startedAt?: string;
        fired?: number;
        levelAttempts?: number;
      } | null) ?? {};
    const startedAt = state.startedAt ? new Date(state.startedAt) : new Date();
    const fired = state.fired ?? 0;
    const stopEvent =
      typeof cfg.stopOnEvent === 'string' ? cfg.stopOnEvent : undefined;
    const waitFor = (n: number): Outcome => ({
      kind: 'wait',
      until:
        ex.mode === 'TEST'
          ? new Date()
          : new Date(startedAt.getTime() + levels[n].afterMs),
      waitingFor: {
        type: 'ESCALATION',
        level: n,
        ...(stopEvent ? { event: stopEvent } : {}),
      },
      context,
    });

    if (!step) {
      await this.saveStep(ex, node, {
        status: 'WAITING',
        attempts: 1,
        output: { startedAt: startedAt.toISOString(), fired: 0 },
      });
      return levels.length === 0
        ? { kind: 'next', label: 'default', context }
        : waitFor(0);
    }
    if (waitingFor?.satisfiedBy) {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: { ...state, stoppedBy: waitingFor.satisfiedBy },
      });
      return { kind: 'next', label: 'default', context };
    }
    if (fired >= levels.length) {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: state,
      });
      return { kind: 'next', label: 'default', context };
    }

    const level = levels[fired];
    // Attempts at THIS level are carried in the escalation's own state, so a failing level cannot retry forever.
    const levelStep = {
      status: 'RUNNING',
      attempts: state.levelAttempts ?? 0,
    } as WorkflowExecutionStep;
    const result = await this.runAction(
      ex,
      wf,
      version,
      node,
      context,
      levelStep,
      level.action,
      level.config ?? {},
      `:L${fired}`,
    );
    if (result.kind === 'wait' || result.kind === 'fail') {
      // runAction wrote its own step row; put the escalation's state back (it must not be erased).
      const attempt =
        result.kind === 'wait' && result.waitingFor.type === 'RETRY'
          ? Number(result.waitingFor.attempt)
          : (state.levelAttempts ?? 0);
      await this.saveStep(ex, node, {
        status: result.kind === 'fail' ? 'FAILED' : 'WAITING',
        attempts: 1,
        output: {
          startedAt: startedAt.toISOString(),
          fired,
          levelAttempts: attempt,
        },
        ...(result.kind === 'fail'
          ? { finished: true, error: result.message }
          : {}),
      });
      return result;
    }
    const nowFired = fired + 1;
    await this.saveStep(ex, node, {
      status: 'WAITING',
      attempts: 1,
      output: {
        startedAt: startedAt.toISOString(),
        fired: nowFired,
        levelAttempts: 0,
      },
    });
    if (nowFired >= levels.length) {
      await this.saveStep(ex, node, {
        status: 'SUCCEEDED',
        finished: true,
        attempts: 1,
        output: { startedAt: startedAt.toISOString(), fired: nowFired },
      });
      return {
        kind: 'next',
        label: 'default',
        context: result.kind === 'next' ? result.context : context,
      };
    }
    return waitFor(nowFired);
  }

  // ----------------------------------------------------------------- helpers

  private async saveStep(
    ex: WorkflowExecution,
    node: WorkflowNode,
    s: {
      status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING' | 'RETRYING';
      attempts: number;
      finished?: boolean;
      input?: Prisma.InputJsonValue;
      output?: unknown;
      trace?: Prisma.InputJsonValue;
      error?: string;
      mocked?: boolean;
      idempotencyKey?: string;
    },
  ): Promise<void> {
    const idempotencyKey = s.idempotencyKey ?? actionKey(ex.id, node.id);
    const data = {
      status: s.status,
      attempts: s.attempts,
      ...(s.input !== undefined ? { input: s.input } : {}),
      ...(s.output !== undefined
        ? { output: redact(s.output) as Prisma.InputJsonValue }
        : {}),
      ...(s.trace !== undefined ? { trace: s.trace } : {}),
      error: s.error ?? null,
      ...(s.mocked !== undefined ? { mocked: s.mocked } : {}),
      finishedAt: s.finished ? new Date() : null,
    };
    await this.prisma.workflowExecutionStep.upsert({
      where: { executionId_nodeId: { executionId: ex.id, nodeId: node.id } },
      create: {
        executionId: ex.id,
        nodeId: node.id,
        nodeType: node.type,
        idempotencyKey,
        ...data,
      },
      update: data,
    });
  }

  /** Terminal failure: nothing is discarded — the execution is parked in the dead-letter queue for a human. */
  private async deadLetter(
    ex: WorkflowExecution,
    nodeId: string | null,
    reason: string,
    error: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.workflowExecution.update({
        where: { id: ex.id },
        data: {
          status: 'DEAD_LETTERED',
          error: error.slice(0, 500),
          nextRunAt: null,
          finishedAt: new Date(),
        },
      }),
      this.prisma.workflowDeadLetter.create({
        data: {
          executionId: ex.id,
          nodeId,
          workflowId: ex.workflowId,
          companyId: ex.companyId,
          reason,
          error: error.slice(0, 1000),
          correlationId: ex.correlationId,
        },
      }),
    ]);
    await this.safeAudit(ex, 'workflow.execution_failed', {
      workflowId: ex.workflowId,
      nodeId,
      reason,
    });
  }

  private async safeAudit(
    ex: WorkflowExecution,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        action,
        entityType: 'WorkflowExecution',
        entityId: ex.id,
        companyId: ex.companyId,
        branchId: ex.branchId ?? undefined,
        metadata: {
          ...metadata,
          correlationId: ex.correlationId,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Audit write failed for ${action}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function safeRender(t: string, context: Ctx): string {
  try {
    return renderTemplate(t, context, { onMissing: 'blank' });
  } catch {
    return t;
  }
}
