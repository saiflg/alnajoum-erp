import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  AiExecutionStatus,
  AiSafetyEventKind,
  AiStepKind,
  AiStepStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  ModelAction as MA,
  Principal,
  RunInput,
  RunResult,
  ToolDefinition,
  Confidence,
} from '../agent.types';
import {
  Facts,
  guardNumbers,
  lowerConfidence,
  renderFacts,
} from '../runtime/facts';
import {
  detectInjection,
  filterOutput,
  maskDeep,
  maskSensitive,
  wrapUntrusted,
} from '../runtime/guards';
import { detectLanguage, isLang, say } from '../runtime/language';
import {
  callSignature,
  checkLoop,
  delegationCreatesCycle,
} from '../runtime/loop-guard';
import { isAffirmation } from '../runtime/mock-agent-planner';
import {
  AiModelClient,
  ModelTurn,
  ModelUnavailable,
} from '../runtime/model-client';
import { decide } from '../runtime/policy-engine';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolError, validateInput } from '../tools/tool-support';
import { AgentAdminService, LoadedAgent } from './agent-admin.service';
import { AiApprovalsService } from './ai-approvals.service';
import { AiBudgetService } from './budget.service';
import { AiControlsService } from './controls.service';
import { AiMemoryService } from './memory.service';
import { AiRecommendationsService } from './recommendations.service';
import { AiSafetyService } from './safety.service';

interface RunState {
  executionId: string;
  correlationId: string;
  agent: LoadedAgent;
  input: RunInput;
  language: string;
  facts: Facts;
  toolResults: {
    tool: string;
    input: Record<string, unknown>;
    ok: boolean;
    output?: Record<string, unknown>;
    error?: string;
  }[];
  delegations: { agent: string; message: string; status: string }[];
  sources: Set<string>;
  signatures: string[];
  seq: number;
  steps: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  startedAt: number;
  approvals: { id: string; toolKey: string; status: string }[];
  stepLog: RunResult['steps'];
  pendingSteps: Prisma.AiExecutionStepCreateManyInput[];
  toolErrors: number;
  failedOver: boolean;
  provider?: string;
  model?: string;
  chain: string[];
  wrotes: boolean;
  userText: string;
  memory: Record<string, unknown>;
  customerLatest: string;
}

const clip = (v: unknown, n = 4000): Prisma.InputJsonValue => {
  const s = JSON.stringify(v ?? null);
  return (
    s.length > n ? { truncated: true, preview: s.slice(0, n) } : JSON.parse(s)
  ) as Prisma.InputJsonValue;
};

/**
 * The agent runtime. It owns the loop; the model only ever proposes the next action as JSON. For each proposal
 * the runtime, in code and in this order: checks the kill switches and budgets, validates the tool and its input,
 * decides allow / needs approval / deny from risk x autonomy x the principal's real permissions, enforces
 * idempotency for anything that changes state, executes through the tool (which uses the existing business
 * service and the principal's tenant/branch scope), filters the output, records the step, and stops the run on
 * any loop, limit, timeout or budget breach. A model cannot widen any of that.
 */
@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentAdminService,
    private readonly tools: ToolRegistryService,
    private readonly controls: AiControlsService,
    private readonly budget: AiBudgetService,
    private readonly safety: AiSafetyService,
    private readonly memory: AiMemoryService,
    private readonly approvals: AiApprovalsService,
    private readonly model: AiModelClient,
    private readonly recommendations: AiRecommendationsService,
  ) {}

  async run(input: RunInput, chain: string[] = []): Promise<RunResult> {
    const principal = input.principal;
    const agent = await this.agents.load(input.agentKey);
    if (principal.kind === 'CUSTOMER' && agent.audience !== 'CUSTOMER')
      throw new ForbiddenException('That assistant is for staff');
    if (principal.kind === 'CUSTOMER' && !principal.customerId)
      throw new ForbiddenException('Sign in to use the assistant');

    const language = isLang(input.language)
      ? input.language
      : detectLanguage(input.objective);
    const correlationId =
      input.correlationId ??
      `ai-${createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 20)}`;
    const depth = input.depth ?? 0;
    const execution = await this.prisma.aiExecution.create({
      data: {
        correlationId,
        agentId: agent.id,
        agentVersionId: agent.versionId,
        promptVersion: agent.promptVersion,
        companyId: principal.companyId ?? undefined,
        branchId: principal.branchId ?? undefined,
        initiatorIdentityId: principal.identityId ?? undefined,
        customerId: principal.customerId ?? undefined,
        conversationId: input.conversationId ?? undefined,
        parentExecutionId: input.parentExecutionId ?? undefined,
        depth,
        channel: input.channel,
        language,
        dryRun: !!input.dryRun,
        objective: maskSensitive(input.objective).slice(0, 4000),
      },
    });
    const st: RunState = {
      executionId: execution.id,
      correlationId,
      agent,
      input,
      language,
      facts: {},
      toolResults: [],
      delegations: [],
      sources: new Set(),
      signatures: [],
      seq: 0,
      steps: 0,
      toolCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      startedAt: Date.now(),
      approvals: [],
      stepLog: [],
      pendingSteps: [],
      toolErrors: 0,
      failedOver: false,
      chain: [...chain, agent.key],
      wrotes: false,
      userText: [
        input.objective,
        ...(input.history ?? [])
          .filter((h) => h.role === 'CUSTOMER')
          .map((h) => h.content),
      ].join(' '),
      memory: {},
      customerLatest: input.objective,
    };

    const finish = (
      status: AiExecutionStatus,
      message: string,
      confidence: Confidence,
      extra: Partial<RunResult> = {},
    ) => this.finish(st, status, message, confidence, extra);

    // 1. Controls, status, budget — before anything else happens.
    const controls = await this.controls.resolve(
      principal.companyId,
      agent.key,
    );
    const flag =
      controls.featureFlags[`channel.${input.channel.toLowerCase()}`];
    if (
      controls.allDisabled ||
      controls.agentDisabled ||
      agent.status !== 'ACTIVE' ||
      flag === false
    ) {
      await this.safety.record({
        kind: 'KILL_SWITCH',
        companyId: principal.companyId,
        executionId: st.executionId,
        agentKey: agent.key,
        identityId: principal.identityId,
        evidence: {
          allDisabled: controls.allDisabled,
          agentDisabled: controls.agentDisabled || agent.status !== 'ACTIVE',
          channelFlag: flag,
        },
      });
      return finish('CANCELLED', say('unavailable', language), 'HIGH', {
        blocked: 'DISABLED',
        handoff: input.channel === 'PORTAL' || input.channel === 'WHATSAPP',
      });
    }
    const verdict = await this.budget.check(principal.companyId, agent.key);
    if (!verdict.ok) {
      await this.safety.record({
        kind: 'BUDGET_EXCEEDED',
        companyId: principal.companyId,
        executionId: st.executionId,
        agentKey: agent.key,
        identityId: principal.identityId,
        evidence: { reason: verdict.reason },
      });
      return finish('ESCALATED', say('budget', language), 'HIGH', {
        blocked: 'BUDGET',
        handoff: true,
      });
    }

    // 2. Refuse blatant attempts without consulting the model at all.
    const scan = detectInjection(input.objective);
    if (scan.flagged) {
      const kind: AiSafetyEventKind = scan.kinds.includes('SECRET_REQUEST')
        ? 'SECRET_REQUEST'
        : scan.kinds.includes('TENANT_ESCAPE')
          ? 'TENANT_ESCAPE'
          : scan.kinds.includes('FINANCIAL_BYPASS')
            ? 'APPROVAL_BYPASS'
            : scan.kinds.includes('ROLE_ESCALATION')
              ? 'UNAUTHORIZED_ACTION'
              : 'PROMPT_INJECTION';
      await this.safety.record({
        kind,
        companyId: principal.companyId,
        executionId: st.executionId,
        agentKey: agent.key,
        identityId: principal.identityId,
        evidence: { kinds: scan.kinds, matches: scan.matches },
      });
      this.step(
        st,
        'GUARD',
        undefined,
        undefined,
        'DENIED',
        { kinds: scan.kinds },
        undefined,
        'Refused before reaching the model',
      );
      const msg =
        kind === 'SECRET_REQUEST'
          ? say('secretRefusal', language)
          : kind === 'TENANT_ESCAPE'
            ? say('tenantRefusal', language)
            : say('refusal', language);
      return finish('REJECTED', msg, 'HIGH', { blocked: kind });
    }

    // 3. Conversation memory (short-term), then the loop.
    if (input.conversationId && principal.companyId) {
      for (const key of ['pendingOffer'] as const) {
        const m = await this.memory.read(
          principal.companyId,
          'SHORT_TERM',
          'CONVERSATION',
          input.conversationId,
          key,
        );
        if (m) st.memory[key] = m.value;
      }
    }
    const cfg = agent.config;
    const limits = {
      maxSteps: cfg.maxSteps,
      maxToolCalls: cfg.maxToolCalls,
      timeoutMs: cfg.timeoutMs,
      maxDepth: cfg.maxDepth,
      maxRepeats: 2,
    };
    const allowed = cfg.tools.filter((t) => !controls.disabledTools.has(t));
    const system = `${agent.systemPrompt}\n\nALNAJOUM_AGENT_PROTOCOL v1\nReply with exactly ONE JSON object, nothing else:\n{"action":"tool","tool":"<name>","input":{...},"why":"<short reason>"}\n{"action":"final","text":"<answer with {{tool.field}} placeholders>","confidence":"HIGH|MEDIUM|LOW|UNKNOWN"}\n{"action":"delegate","agent":"<key>","objective":"<what to do>"}\n{"action":"handoff","reason":"<why a person should take over>"}\nTools you may use:\n${JSON.stringify(this.tools.describe(allowed))}`;

    for (;;) {
      const verdictLoop = checkLoop(
        {
          steps: st.steps,
          toolCalls: st.toolCalls,
          startedAt: st.startedAt,
          signatures: st.signatures,
          depth,
          chain: st.chain,
        },
        limits,
      );
      if (!verdictLoop.ok) {
        if (
          (verdictLoop.reason !== 'TIMEOUT' &&
            verdictLoop.reason !== 'MAX_STEPS' &&
            verdictLoop.reason !== 'MAX_TOOL_CALLS') ||
          verdictLoop.reason === 'MAX_STEPS'
        )
          await this.safety.record({
            kind: 'LOOP_DETECTED',
            companyId: principal.companyId,
            executionId: st.executionId,
            agentKey: agent.key,
            identityId: principal.identityId,
            evidence: {
              reason: verdictLoop.reason,
              detail: verdictLoop.detail,
            },
          });
        this.step(
          st,
          'GUARD',
          undefined,
          undefined,
          'DENIED',
          { reason: verdictLoop.reason },
          undefined,
          verdictLoop.detail,
        );
        return finish('FAILED', say('handoff', language), 'LOW', {
          handoff: this.customerFacing(input),
          blocked: `LOOP_${verdictLoop.reason}`,
        });
      }
      if (
        st.promptTokens + st.completionTokens > cfg.budget.maxTokens ||
        st.costMicros > cfg.budget.maxCostMicros
      ) {
        await this.safety.record({
          kind: 'BUDGET_EXCEEDED',
          companyId: principal.companyId,
          executionId: st.executionId,
          agentKey: agent.key,
          identityId: principal.identityId,
          evidence: {
            scope: 'per-execution',
            tokens: st.promptTokens + st.completionTokens,
            costMicros: st.costMicros,
          },
        });
        return finish('FAILED', say('budget', language), 'LOW', {
          handoff: this.customerFacing(input),
          blocked: 'EXECUTION_BUDGET',
        });
      }

      let turn: ModelTurn;
      try {
        turn = await this.model.next({
          agentKey: agent.key,
          config: cfg,
          system,
          payload: {
            agent: agent.key,
            language,
            objective: wrapUntrusted('user message', input.objective),
            history: (input.history ?? []).slice(-8).map((h) => ({
              role: h.role,
              content: maskSensitive(h.content).slice(0, 800),
            })),
            tools: allowed,
            toolResults: st.toolResults.map((r) => ({
              ...r,
              output: r.output ? maskDeep(r.output) : undefined,
            })),
            memory: st.memory,
            delegations: st.delegations,
          },
          timeoutMs: Math.max(
            1000,
            Math.min(
              cfg.timeoutMs - (Date.now() - st.startedAt),
              cfg.timeoutMs,
            ),
          ),
        });
      } catch (err) {
        const reason =
          err instanceof ModelUnavailable
            ? err.message
            : (err as Error).message;
        this.step(
          st,
          'MODEL',
          undefined,
          undefined,
          'ERROR',
          undefined,
          undefined,
          reason,
        );
        return finish('FAILED', say('unavailable', language), 'UNKNOWN', {
          handoff: this.customerFacing(input),
          blocked: 'MODEL_UNAVAILABLE',
        });
      }
      st.steps++;
      st.promptTokens += turn.promptTokens;
      st.completionTokens += turn.completionTokens;
      st.costMicros += turn.costMicros;
      st.provider = turn.provider;
      st.model = turn.model;
      st.failedOver = st.failedOver || turn.failedOver;
      this.step(
        st,
        'MODEL',
        undefined,
        undefined,
        'OK',
        {
          action: turn.action.action,
          provider: turn.provider,
          failedOver: turn.failedOver,
          attempts: turn.attempts,
        },
        undefined,
        undefined,
        turn.latencyMs,
      );

      const action: MA = turn.action;
      if (action.action === 'final') return this.onFinal(st, action, finish);
      if (action.action === 'handoff')
        return this.onHandoff(st, action.reason, finish);
      if (action.action === 'delegate') {
        const r = await this.onDelegate(st, action, principal, depth);
        if (r) return finish(r.status, r.message, r.confidence, r.extra);
        continue;
      }
      const outcome = await this.onTool(st, action, controls, principal);
      if (outcome)
        return finish(
          outcome.status,
          outcome.message,
          outcome.confidence,
          outcome.extra,
        );
    }
  }

  /** Dry run: everything the agent WOULD do, with no state change and no approvals created. */
  simulate(input: Omit<RunInput, 'dryRun' | 'channel'>) {
    return this.run({ ...input, dryRun: true, channel: 'SIMULATION' });
  }

  private customerFacing = (i: RunInput) =>
    i.channel === 'PORTAL' || i.channel === 'WHATSAPP';

  // ------------------------------------------------------------------------------------------ tool step
  private async onTool(
    st: RunState,
    a: Extract<MA, { action: 'tool' }>,
    controls: Awaited<ReturnType<AiControlsService['resolve']>>,
    principal: Principal,
  ): Promise<{
    status: AiExecutionStatus;
    message: string;
    confidence: Confidence;
    extra?: Partial<RunResult>;
  } | null> {
    const tool = this.tools.get(a.tool);
    const sig = callSignature(a.tool, a.input ?? {});
    st.signatures.push(sig);
    st.toolCalls++;
    const agent = st.agent;
    const record = (
      ok: boolean,
      error?: string,
      output?: Record<string, unknown>,
    ) =>
      st.toolResults.push({
        tool: a.tool,
        input: a.input ?? {},
        ok,
        error,
        output,
      });

    const d = decide({
      tool,
      toolKey: a.tool,
      agentAudience: agent.audience,
      config: agent.config,
      principal,
      controls,
      dryRun: !!st.input.dryRun,
    });
    if (d.outcome === 'DENY') {
      if (d.safetyKind)
        await this.safety.record({
          kind: d.safetyKind,
          companyId: principal.companyId,
          executionId: st.executionId,
          agentKey: agent.key,
          identityId: principal.identityId,
          evidence: { tool: a.tool, reason: d.reason },
        });
      this.step(
        st,
        'TOOL',
        a.tool,
        tool?.risk,
        'DENIED',
        a.input,
        undefined,
        d.reason,
      );
      st.toolErrors++;
      record(false, d.reason);
      return null;
    }
    const v = validateInput(tool!.input, a.input ?? {});
    if (!v.ok) {
      this.step(
        st,
        'TOOL',
        a.tool,
        tool!.risk,
        'ERROR',
        a.input,
        undefined,
        v.error,
      );
      st.toolErrors++;
      record(false, `Invalid input: ${v.error}`);
      return null;
    }
    let input = v.value;

    // The customer's confirmation is verified HERE, from what the customer actually wrote — never from the model.
    if (a.tool === 'prepareFlightBooking') {
      const pending = st.memory.pendingOffer as
        { offers?: { offerId: string }[] } | undefined;
      const confirmed =
        isAffirmation(st.customerLatest) &&
        !!pending?.offers?.some((o) => o.offerId === input.offerId);
      input = { ...input, customerConfirmed: confirmed };
      if (!confirmed) {
        this.step(
          st,
          'TOOL',
          a.tool,
          tool!.risk,
          'DENIED',
          input,
          undefined,
          'No explicit customer confirmation of this offer',
        );
        record(
          false,
          'I need your explicit confirmation of this offer before I can book it.',
        );
        return null;
      }
    }

    if (d.outcome === 'PROPOSE_ONLY') {
      this.step(
        st,
        'TOOL',
        a.tool,
        tool!.risk,
        'SKIPPED',
        input,
        { proposed: true },
        d.reason,
      );
      if (principal.companyId && !st.input.dryRun)
        await this.recommendations.upsert({
          companyId: principal.companyId,
          branchId: principal.branchId,
          agentKey: agent.key,
          kind: `PROPOSED_${a.tool}`,
          dedupeKey: `proposal:${agent.key}:${a.tool}:${this.idemKey(principal, a.tool, input, tool!)}`,
          title: `Suggested: ${tool!.description.split('.')[0]}`,
          reason: a.why ?? 'Suggested by the assistant',
          evidence: [
            {
              label: 'Proposed input',
              source: `AI agent ${agent.key}`,
              value: maskDeep(input),
            },
          ],
          confidence: 'MEDIUM',
          factors: {
            customerImpact: 1,
            regulatoryImpact: 0,
            dependency: 0,
            risk: 0,
          },
        });
      record(true, undefined, {
        proposed: true,
        note: 'Recorded as a suggestion for staff; not executed.',
      });
      return null;
    }

    if (d.outcome === 'REQUIRE_APPROVAL') {
      if (st.input.dryRun) {
        const preview = tool!.preview?.(input);
        this.step(st, 'APPROVAL', a.tool, tool!.risk, 'SIMULATED', input, {
          wouldRequestApproval: true,
          preview,
        });
        record(true, undefined, {
          simulated: true,
          wouldRequestApproval: true,
          preview: preview as unknown as Record<string, unknown>,
        });
        st.sources.add('Approval policy');
        return null;
      }
      const row = await this.approvals.request({
        executionId: st.executionId,
        agentId: agent.id,
        agentKey: agent.key,
        tool: tool!,
        input,
        reason: a.why ?? `${agent.key} requested ${a.tool}`,
        companyId: principal.companyId,
        branchId: principal.branchId,
        initiatorIdentityId: principal.identityId,
      });
      st.approvals.push({ id: row.id, toolKey: a.tool, status: row.status });
      this.step(st, 'APPROVAL', a.tool, tool!.risk, 'PENDING_APPROVAL', input, {
        approvalId: row.id,
      });
      record(true, undefined, { approvalRequested: true, approvalId: row.id });
      st.sources.add('Human approval');
      // The run now waits for a person; nothing else is attempted in this run.
      const msg = this.customerFacing(st.input)
        ? say('approvalNeeded', st.language)
        : `I have asked for approval to: ${tool!.preview?.(input).action ?? tool!.description}. It will be carried out only if an authorised person approves it (request ${row.id}).`;
      return {
        status: 'WAITING_APPROVAL',
        message: msg,
        confidence: 'HIGH',
        extra: { approvals: st.approvals },
      };
    }

    // ALLOW
    if (st.input.dryRun && tool!.writes) {
      this.step(st, 'TOOL', a.tool, tool!.risk, 'SIMULATED', input, {
        wouldExecute: tool!.description,
      });
      record(true, undefined, {
        simulated: true,
        wouldExecute: tool!.description,
      });
      return null;
    }
    const started = Date.now();
    try {
      const out = await this.executeOnce(st, tool!, input, principal);
      st.wrotes = st.wrotes || tool!.writes;
      const data = filterOutput(out.data);
      st.facts[a.tool] = data;
      out.sources.forEach((s) => st.sources.add(s));
      await this.afterTool(st, a.tool, data, principal);
      this.step(
        st,
        'TOOL',
        a.tool,
        tool!.risk,
        'OK',
        input,
        data,
        out.summary,
        Date.now() - started,
      );
      record(true, undefined, data);
      if (tool!.writes)
        await this.audit.record({
          identityId: principal.identityId ?? undefined,
          companyId: principal.companyId ?? undefined,
          branchId: principal.branchId ?? undefined,
          action: 'ai.tool_executed',
          entityType: out.resourceType ?? 'AiTool',
          entityId: out.resourceId,
          metadata: {
            agent: agent.key,
            agentVersion: agent.version,
            promptVersion: agent.promptVersion,
            tool: a.tool,
            executionId: st.executionId,
            summary: out.summary ?? null,
            model: st.model ?? null,
          },
        });
    } catch (err) {
      st.toolErrors++;
      const msg =
        err instanceof ToolError
          ? err.message
          : 'The system could not complete that just now.';
      if (!(err instanceof ToolError))
        this.logger.warn(`Tool ${a.tool} failed: ${(err as Error).message}`);
      this.step(
        st,
        'TOOL',
        a.tool,
        tool!.risk,
        'ERROR',
        input,
        undefined,
        msg,
        Date.now() - started,
      );
      record(false, msg);
    }
    return null;
  }

  /**
   * Runs a tool; for state-changing tools, exactly once per (company, tool, input, window, principal): the
   * action record is claimed BEFORE acting, so two identical requests at the same instant, or a model that
   * repeats itself, produce one action and the same result.
   */
  private async executeOnce(
    st: RunState,
    tool: ToolDefinition,
    input: Record<string, unknown>,
    principal: Principal,
  ) {
    const key = this.idemKey(principal, tool.key, input, tool);
    const ctx = {
      principal,
      agentKey: st.agent.key,
      executionId: st.executionId,
      correlationId: st.correlationId,
      conversationId: st.input.conversationId ?? null,
      dryRun: !!st.input.dryRun,
      language: st.language,
      idempotencyKey: key,
    };
    if (!tool.writes) return tool.execute(ctx, input);
    const companyId = principal.companyId ?? 'platform';
    try {
      await this.prisma.aiActionRecord.create({
        data: {
          companyId,
          idempotencyKey: key,
          toolKey: tool.key,
          executionId: st.executionId,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      for (let i = 0; i < 25; i++) {
        const existing = await this.prisma.aiActionRecord.findUnique({
          where: {
            companyId_idempotencyKey: { companyId, idempotencyKey: key },
          },
        });
        if (existing?.result) {
          const r = existing.result as {
            data: Record<string, unknown>;
            sources: string[];
            summary?: string;
            resourceType?: string;
            resourceId?: string;
          };
          return {
            ...r,
            summary: `${r.summary ?? 'Done'} (already done earlier; not repeated)`,
          };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new ToolError('CONFLICT', 'The same action is already in progress');
    }
    try {
      const out = await tool.execute(ctx, input);
      await this.prisma.aiActionRecord.update({
        where: { companyId_idempotencyKey: { companyId, idempotencyKey: key } },
        data: { result: out as unknown as Prisma.InputJsonValue },
      });
      return out;
    } catch (err) {
      // A failed action leaves nothing behind, so a retry can run it.
      await this.prisma.aiActionRecord
        .delete({
          where: {
            companyId_idempotencyKey: { companyId, idempotencyKey: key },
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  private idemKey(
    principal: Principal,
    toolKey: string,
    input: Record<string, unknown>,
    tool: ToolDefinition,
  ): string {
    const now = new Date();
    const bucket =
      tool.idempotencyWindow === 'hour'
        ? now.toISOString().slice(0, 13)
        : now.toISOString().slice(0, 10);
    const scope = principal.customerId ?? principal.identityId ?? 'system';
    return createHash('sha256')
      .update(
        `${principal.companyId}|${scope}|${callSignature(toolKey, input)}|${bucket}`,
      )
      .digest('hex')
      .slice(0, 40);
  }

  /** Conversation memory side effects of specific tools (all allow-listed keys). */
  private async afterTool(
    st: RunState,
    tool: string,
    data: Record<string, unknown>,
    principal: Principal,
  ) {
    const convo = st.input.conversationId;
    if (!convo || !principal.companyId || st.input.dryRun) return;
    const base = {
      companyId: principal.companyId,
      type: 'SHORT_TERM' as const,
      subjectType: 'CONVERSATION',
      subjectId: convo,
      source: st.agent.key,
    };
    if (tool === 'searchFlights') {
      const offers = (
        (data.offers as { offerId: string; total: { amount: number } }[]) ?? []
      )
        .slice(0, 3)
        .map((o) => ({ offerId: o.offerId, amount: o.total.amount }));
      if (offers.length) {
        await this.memory.write({
          ...base,
          key: 'pendingOffer',
          value: { offers },
        });
        st.memory.pendingOffer = { offers };
      }
    }
    if (tool === 'revalidateFlightOffer') {
      const pending = st.memory.pendingOffer as
        { offers: { offerId: string; amount: number }[] } | undefined;
      if (pending) {
        const cur = (data.current as { amount: number }).amount;
        const offers = pending.offers.map((o) =>
          o.offerId === data.offerId ? { ...o, amount: cur } : o,
        );
        await this.memory.write({
          ...base,
          key: 'pendingOffer',
          value: { offers },
        });
        st.memory.pendingOffer = { offers };
      }
    }
    if (tool === 'prepareFlightBooking') {
      await this.memory.deleteKey(
        principal.companyId,
        'SHORT_TERM',
        'CONVERSATION',
        convo,
        'pendingOffer',
      );
      delete st.memory.pendingOffer;
    }
  }

  // ------------------------------------------------------------------------------------------ final / handoff / delegate
  private async onFinal(
    st: RunState,
    a: Extract<MA, { action: 'final' }>,
    finish: (
      s: AiExecutionStatus,
      m: string,
      c: Confidence,
      e?: Partial<RunResult>,
    ) => Promise<RunResult>,
  ) {
    let confidence: Confidence = a.confidence;
    const guarded = guardNumbers(
      a.text,
      st.facts,
      st.userText + ' ' + JSON.stringify(st.delegations),
      st.language,
    );
    if (guarded.unverified.length) {
      confidence = lowerConfidence(confidence, 'LOW');
      await this.safety.record({
        kind: 'UNVERIFIED_NUMBER',
        companyId: st.input.principal.companyId,
        executionId: st.executionId,
        agentKey: st.agent.key,
        identityId: st.input.principal.identityId,
        evidence: { numbers: guarded.unverified },
      });
    }
    const flatFacts: Facts = { ...st.facts };
    for (const d of st.delegations)
      flatFacts[`delegate_${d.agent}`] = {
        message: d.message,
        status: d.status,
      };
    const rendered = renderFacts(guarded.text, flatFacts, st.language);
    let text = rendered.text.replace(/\n{3,}/g, '\n\n').trim();
    if (rendered.missing.length) {
      confidence = lowerConfidence(confidence, 'LOW');
      text += `\n${say('unverified', st.language)}`;
    }
    if (st.toolErrors > 0) confidence = lowerConfidence(confidence, 'MEDIUM');
    // Company communication policy: prohibited content never goes out.
    const controls = await this.controls.resolve(
      st.input.principal.companyId,
      st.agent.key,
    );
    const bad = controls.commPolicy.prohibitedContent.find((p) =>
      text.toLowerCase().includes(p.toLowerCase()),
    );
    if (bad) {
      await this.safety.record({
        kind: 'POLICY_VIOLATION',
        companyId: st.input.principal.companyId,
        executionId: st.executionId,
        agentKey: st.agent.key,
        identityId: st.input.principal.identityId,
        evidence: { prohibited: bad },
      });
      return this.onHandoff(
        st,
        'The drafted reply contained content the company policy prohibits',
        finish,
      );
    }
    if (
      !a.needsInfo &&
      (confidence === 'LOW' || confidence === 'UNKNOWN') &&
      st.agent.config.escalationPolicy.onLowConfidence === 'HANDOFF' &&
      this.customerFacing(st.input)
    )
      return this.onHandoff(st, 'Low confidence in the answer', finish, text);
    // Sources come ONLY from the tools that actually ran; whatever the model claims is ignored.
    return finish('COMPLETED', text, confidence, { sources: [...st.sources] });
  }

  private async onHandoff(
    st: RunState,
    reason: string,
    finish: (
      s: AiExecutionStatus,
      m: string,
      c: Confidence,
      e?: Partial<RunResult>,
    ) => Promise<RunResult>,
    draft?: string,
  ) {
    const p = st.input.principal;
    this.step(
      st,
      'ESCALATION',
      undefined,
      undefined,
      'OK',
      { reason },
      undefined,
      reason,
    );
    if (p.companyId && !st.input.dryRun) {
      await this.recommendations.upsert({
        companyId: p.companyId,
        branchId: p.branchId,
        agentKey: st.agent.key,
        kind: 'HUMAN_HANDOFF',
        dedupeKey: `handoff:${st.input.conversationId ?? st.executionId}`,
        title: 'A customer needs a person',
        reason,
        confidence: 'HIGH',
        evidence: [
          {
            label: 'Why the assistant handed over',
            source: `AI agent ${st.agent.key}`,
            value: reason,
          },
        ],
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 1,
          hoursToDeadline: 24,
        },
        subjectType: 'CUSTOMER',
        subjectId: p.customerId ?? undefined,
      });
    }
    void draft;
    return finish('HANDED_OFF', say('handoff', st.language), 'HIGH', {
      handoff: true,
    });
  }

  private async onDelegate(
    st: RunState,
    a: Extract<MA, { action: 'delegate' }>,
    principal: Principal,
    depth: number,
  ): Promise<{
    status: AiExecutionStatus;
    message: string;
    confidence: Confidence;
    extra?: Partial<RunResult>;
  } | null> {
    const allowedTargets = st.agent.config.delegates ?? [];
    st.signatures.push(
      callSignature(`delegate:${a.agent}`, { o: a.objective }),
    );
    if (
      !allowedTargets.includes(a.agent) ||
      delegationCreatesCycle(st.chain, a.agent)
    ) {
      await this.safety.record({
        kind: 'LOOP_DETECTED',
        companyId: principal.companyId,
        executionId: st.executionId,
        agentKey: st.agent.key,
        identityId: principal.identityId,
        evidence: { delegateTo: a.agent, chain: st.chain },
      });
      this.step(
        st,
        'DELEGATION',
        undefined,
        undefined,
        'DENIED',
        { to: a.agent },
        undefined,
        'Delegation not allowed',
      );
      st.delegations.push({
        agent: a.agent,
        message: 'That specialist is not available to this agent.',
        status: 'DENIED',
      });
      return null;
    }
    // The specialist works with ITS OWN tool list and the SAME person's access: delegation never adds authority.
    const child = await this.run(
      {
        agentKey: a.agent,
        objective: a.objective,
        principal,
        channel: st.input.channel,
        language: st.language,
        dryRun: st.input.dryRun,
        parentExecutionId: st.executionId,
        correlationId: st.correlationId,
        depth: depth + 1,
        conversationId: st.input.conversationId,
      },
      st.chain,
    );
    st.promptTokens += 0;
    this.step(
      st,
      'DELEGATION',
      undefined,
      undefined,
      'OK',
      { to: a.agent, status: child.status },
      { message: child.message.slice(0, 500) },
    );
    st.delegations.push({
      agent: a.agent,
      message: child.message,
      status: child.status,
    });
    child.sources.forEach((s) => st.sources.add(s));
    st.approvals.push(...child.approvals);
    return null;
  }

  // ------------------------------------------------------------------------------------------ recording
  private step(
    st: RunState,
    kind: AiStepKind,
    toolKey: string | undefined,
    risk: ToolDefinition['risk'] | undefined,
    status: AiStepStatus,
    input?: unknown,
    output?: unknown,
    note?: string,
    latencyMs?: number,
  ) {
    const seq = ++st.seq;
    st.stepLog.push({ seq, kind, tool: toolKey, status, note });
    if (!st.agent.config.audit.storeSteps) return;
    // Steps are buffered and written in ONE insert when the run ends (a run used to make a database round trip
    // per step, which dominated its latency under load).
    st.pendingSteps.push({
      executionId: st.executionId,
      seq,
      kind,
      toolKey,
      risk,
      status,
      input: input === undefined ? undefined : clip(maskDeep(input)),
      output: output === undefined ? undefined : clip(filterOutput(output)),
      error:
        status === 'ERROR' || status === 'DENIED'
          ? note?.slice(0, 500)
          : undefined,
      latencyMs,
    });
  }

  private async finish(
    st: RunState,
    status: AiExecutionStatus,
    message: string,
    confidence: Confidence,
    extra: Partial<RunResult> = {},
  ): Promise<RunResult> {
    const latencyMs = Date.now() - st.startedAt;
    const result: RunResult = {
      executionId: st.executionId,
      status,
      message,
      confidence,
      sources: extra.sources ?? [...st.sources],
      language: st.language,
      approvals: extra.approvals ?? st.approvals,
      handoff: !!extra.handoff,
      blocked: extra.blocked,
      steps: st.stepLog,
    };
    if (st.pendingSteps.length)
      await this.prisma.aiExecutionStep
        .createMany({ data: st.pendingSteps })
        .catch((e) =>
          this.logger.warn(`Could not store steps: ${(e as Error).message}`),
        );
    await this.prisma.aiExecution
      .update({
        where: { id: st.executionId },
        data: {
          status,
          confidence,
          finishedAt: status === 'WAITING_APPROVAL' ? null : new Date(),
          latencyMs,
          promptTokens: st.promptTokens,
          completionTokens: st.completionTokens,
          costMicros: st.costMicros,
          stepCount: st.steps,
          toolCallCount: st.toolCalls,
          provider: st.provider,
          model: st.model,
          result: clip({
            message,
            sources: result.sources,
            approvals: result.approvals,
            blocked: result.blocked,
            failedOver: st.failedOver,
          }),
          error:
            status === 'FAILED' || status === 'REJECTED'
              ? (result.blocked ?? 'failed')
              : undefined,
        },
      })
      .catch((e) =>
        this.logger.warn(`Could not finish execution: ${(e as Error).message}`),
      );
    const p = st.input.principal;
    if (st.wrotes || st.approvals.length)
      await this.audit.record({
        identityId: p.identityId ?? undefined,
        companyId: p.companyId ?? undefined,
        branchId: p.branchId ?? undefined,
        action: 'ai.execution',
        entityType: 'AiExecution',
        entityId: st.executionId,
        metadata: {
          agent: st.agent.key,
          version: st.agent.version,
          promptVersion: st.agent.promptVersion,
          model: st.model ?? null,
          status,
          approvals: st.approvals.map((x) => x.id),
          tools: st.toolResults.map((t) => t.tool),
        },
      });
    return result;
  }
}
