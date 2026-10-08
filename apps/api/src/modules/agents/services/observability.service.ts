import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GLOBAL } from './controls.service';

const DAY = 86_400_000;

/**
 * Dashboards for the AI control centre. Everything is counted from the records themselves (executions, steps,
 * approvals, feedback, safety events). The two scores are reported as their COMPONENTS first, with an indicative
 * composite: neither is meant to be read as absolute truth, and a component with no data says so rather than
 * defaulting to a flattering number.
 */
@Injectable()
export class AiObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(companyId: string | undefined, days = 7) {
    const since = new Date(Date.now() - days * DAY);
    const exWhere = {
      ...(companyId ? { companyId } : {}),
      startedAt: { gte: since },
    };
    const [
      byStatus,
      byAgent,
      totals,
      stepStats,
      approvals,
      feedback,
      safety,
      queue,
      handoffs,
      agents,
      controls,
    ] = await Promise.all([
      this.prisma.aiExecution.groupBy({
        by: ['status'],
        where: exWhere,
        _count: { _all: true },
      }),
      this.prisma.aiExecution.groupBy({
        by: ['agentId'],
        where: exWhere,
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, costMicros: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiExecution.aggregate({
        where: exWhere,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          costMicros: true,
          toolCallCount: true,
        },
        _avg: { latencyMs: true },
        _count: { _all: true },
      }),
      this.prisma.aiExecutionStep.groupBy({
        by: ['status'],
        where: { kind: 'TOOL', execution: exWhere },
        _count: { _all: true },
      }),
      this.prisma.aiApproval.groupBy({
        by: ['status'],
        where: {
          ...(companyId ? { companyId } : {}),
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.aiFeedback.groupBy({
        by: ['rating'],
        where: {
          ...(companyId ? { companyId } : {}),
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.aiSafetyEvent.groupBy({
        by: ['kind'],
        where: {
          ...(companyId ? { companyId } : {}),
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.aiExecution.groupBy({
        by: ['status'],
        where: {
          ...(companyId ? { companyId } : {}),
          status: { in: ['RUNNING', 'WAITING_APPROVAL', 'WAITING_CUSTOMER'] },
        },
        _count: { _all: true },
      }),
      this.prisma.aiConversation.count({
        where: {
          ...(companyId ? { companyId } : {}),
          status: { in: ['PAUSED', 'HUMAN_TAKEN'] },
          lastMessageAt: { gte: since },
        },
      }),
      this.prisma.aiAgent.findMany({
        select: { id: true, key: true, name: true, status: true },
      }),
      this.prisma.aiControl.findMany({
        where: { scopeKey: { in: companyId ? [GLOBAL, companyId] : [GLOBAL] } },
      }),
    ]);
    const n = (
      rows: {
        status?: string;
        rating?: string;
        kind?: string;
        _count: { _all: number };
      }[],
      key: string,
    ) =>
      rows.find((r) => (r.status ?? r.rating ?? r.kind) === key)?._count._all ??
      0;
    const agentName = new Map(agents.map((a) => [a.id, a]));
    const toolOk = n(stepStats, 'OK');
    const toolBad = n(stepStats, 'ERROR') + n(stepStats, 'DENIED');
    const rated = [
      'CORRECT',
      'INCORRECT',
      'PARTIAL',
      'UNSAFE',
      'NEEDS_REVIEW',
    ].reduce((s, k) => s + n(feedback, k), 0);
    const judged =
      n(feedback, 'CORRECT') +
      n(feedback, 'INCORRECT') +
      n(feedback, 'PARTIAL') +
      n(feedback, 'UNSAFE');
    const total = totals._count._all;
    const quality = {
      accuracy: judged
        ? Math.round(
            ((n(feedback, 'CORRECT') + 0.5 * n(feedback, 'PARTIAL')) / judged) *
              100,
          )
        : null,
      toolSuccessRate:
        toolOk + toolBad
          ? Math.round((toolOk / (toolOk + toolBad)) * 100)
          : null,
      humanCorrectionRate: rated
        ? Math.round(
            ((n(feedback, 'INCORRECT') + n(feedback, 'UNSAFE')) / rated) * 100,
          )
        : null,
      escalationRate: total
        ? Math.round(
            ((n(byStatus, 'ESCALATED') + n(byStatus, 'HANDED_OFF')) / total) *
              100,
          )
        : null,
      hallucinationReports: n(safety, 'UNVERIFIED_NUMBER'),
      ratedAnswers: rated,
      note: 'Indicative only: each component has its own sample size, and a missing value means there was not enough data.',
    };
    const attempts = [
      'UNAUTHORIZED_ACTION',
      'PROMPT_INJECTION',
      'APPROVAL_BYPASS',
      'SECRET_REQUEST',
      'TENANT_ESCAPE',
      'POLICY_VIOLATION',
    ].reduce((s, k) => s + n(safety, k), 0);
    return {
      windowDays: days,
      executions: {
        total,
        byStatus: Object.fromEntries(
          byStatus.map((r) => [r.status, r._count._all]),
        ),
        failed: n(byStatus, 'FAILED'),
        completed: n(byStatus, 'COMPLETED'),
        escalated: n(byStatus, 'ESCALATED') + n(byStatus, 'HANDED_OFF'),
        avgLatencyMs: totals._avg.latencyMs
          ? Math.round(totals._avg.latencyMs)
          : null,
      },
      activeNow: Object.fromEntries(
        queue.map((r) => [r.status, r._count._all]),
      ),
      tokens: {
        prompt: totals._sum.promptTokens ?? 0,
        completion: totals._sum.completionTokens ?? 0,
      },
      costUsd: Number(((totals._sum.costMicros ?? 0) / 1_000_000).toFixed(4)),
      toolCalls: { total: totals._sum.toolCallCount ?? 0, errors: toolBad },
      humanHandoffs: handoffs,
      approvals: Object.fromEntries(
        approvals.map((r) => [r.status, r._count._all]),
      ),
      feedback: Object.fromEntries(
        feedback.map((r) => [r.rating, r._count._all]),
      ),
      perAgent: byAgent
        .map((r) => ({
          agent: agentName.get(r.agentId)?.key ?? r.agentId,
          name: agentName.get(r.agentId)?.name,
          status: agentName.get(r.agentId)?.status,
          runs: r._count._all,
          tokens: (r._sum.promptTokens ?? 0) + (r._sum.completionTokens ?? 0),
          costUsd: Number(((r._sum.costMicros ?? 0) / 1_000_000).toFixed(4)),
          avgLatencyMs: r._avg.latencyMs ? Math.round(r._avg.latencyMs) : null,
        }))
        .sort((a, b) => b.runs - a.runs),
      quality,
      safety: {
        byKind: Object.fromEntries(safety.map((r) => [r.kind, r._count._all])),
        blockedAttempts: attempts,
        note: 'These are attempts that were blocked in code. A rise means someone is testing the assistant, not that a control failed.',
      },
      agents: agents.map((a) => ({
        key: a.key,
        name: a.name,
        status: a.status,
      })),
      controls: controls.map((c) => ({
        scope: c.scopeKey === GLOBAL ? 'GLOBAL' : 'COMPANY',
        kind: c.kind,
        target: c.targetKey,
        value: c.value,
        reason: c.reason,
        at: c.updatedAt,
      })),
    };
  }

  executions(
    companyId: string | undefined,
    filters: { agentKey?: string; status?: string; conversationId?: string },
    take = 100,
  ) {
    return this.prisma.aiExecution.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.agentKey ? { agent: { key: filters.agentKey } } : {}),
        ...(filters.conversationId
          ? { conversationId: filters.conversationId }
          : {}),
      },
      select: {
        id: true,
        correlationId: true,
        status: true,
        channel: true,
        objective: true,
        confidence: true,
        startedAt: true,
        finishedAt: true,
        latencyMs: true,
        promptTokens: true,
        completionTokens: true,
        costMicros: true,
        stepCount: true,
        toolCallCount: true,
        dryRun: true,
        depth: true,
        provider: true,
        model: true,
        promptVersion: true,
        agent: { select: { key: true, name: true } },
        agentVersion: { select: { version: true } },
      },
      orderBy: { startedAt: 'desc' },
      take,
    });
  }

  async execution(companyId: string | undefined, id: string) {
    return this.prisma.aiExecution.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      include: {
        agent: { select: { key: true, name: true } },
        agentVersion: { select: { version: true, promptVersion: true } },
        steps: { orderBy: { seq: 'asc' } },
        approvals: {
          select: { id: true, toolKey: true, status: true, risk: true },
        },
        children: {
          select: { id: true, status: true, agent: { select: { key: true } } },
        },
      },
    });
  }

  safetyEvents(companyId: string | undefined, take = 100) {
    return this.prisma.aiSafetyEvent.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** The audit trail of AI actions: every state-changing step, who started it, which agent and version. */
  async actionAudit(companyId: string | undefined, take = 100) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        action: { startsWith: 'ai.' },
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        identityId: true,
        metadata: true,
        reason: true,
        createdAt: true,
      },
    });
  }
}
