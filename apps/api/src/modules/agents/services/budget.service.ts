import { BadRequestException, Injectable } from '@nestjs/common';
import { AiBudgetPeriod } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { GLOBAL } from './controls.service';

export interface BudgetUsage {
  period: AiBudgetPeriod;
  agentKey: string;
  scopeKey: string;
  usedTokens: number;
  usedRequests: number;
  usedCostMicros: number;
  maxTokens: number | null;
  maxRequests: number | null;
  maxCostMicros: number | null;
  /** 0–1 of the tightest limit that is set. */
  fraction: number;
}

export interface BudgetVerdict {
  ok: boolean;
  /** The limit that blocks, e.g. "tenant daily token budget". */
  reason?: string;
  warnings: BudgetUsage[];
  usage: BudgetUsage[];
}

const periodStart = (period: AiBudgetPeriod, now = new Date()): Date => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  if (period === 'MONTHLY') d.setUTCDate(1);
  return d;
};
export const periodKey = (period: AiBudgetPeriod, now = new Date()): string =>
  `${period}:${periodStart(period, now).toISOString().slice(0, 10)}`;

/**
 * Token, request and cost limits per day/month, per tenant and per agent, with a GLOBAL default that applies to
 * every company and company rows that can only tighten it. Usage is summed from the execution records themselves
 * (the single source of truth), so there is no second counter to drift. A run is refused BEFORE it starts when a
 * limit is already reached; a single run is additionally capped by the agent's own per-execution budget.
 */
@Injectable()
export class AiBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async check(
    companyId: string | null,
    agentKey: string,
    now = new Date(),
  ): Promise<BudgetVerdict> {
    const scopes = companyId ? [GLOBAL, companyId] : [GLOBAL];
    const rows = await this.prisma.aiBudget.findMany({
      where: {
        scopeKey: { in: scopes },
        agentKey: { in: ['', agentKey] },
        enabled: true,
      },
    });
    const usage: BudgetUsage[] = [];
    let blockReason: string | undefined;
    for (const b of rows) {
      const agg = await this.prisma.aiExecution.aggregate({
        where: {
          ...(companyId ? { companyId } : {}),
          ...(b.agentKey ? { agent: { key: b.agentKey } } : {}),
          startedAt: { gte: periodStart(b.period, now) },
        },
        _sum: { promptTokens: true, completionTokens: true, costMicros: true },
        _count: { _all: true },
      });
      const usedTokens =
        (agg._sum.promptTokens ?? 0) + (agg._sum.completionTokens ?? 0);
      const usedCost = agg._sum.costMicros ?? 0;
      const usedRequests = agg._count._all;
      const fractions = [
        b.maxTokens ? usedTokens / b.maxTokens : 0,
        b.maxRequests ? usedRequests / b.maxRequests : 0,
        b.maxCostMicros ? usedCost / b.maxCostMicros : 0,
      ];
      const u: BudgetUsage = {
        period: b.period,
        agentKey: b.agentKey,
        scopeKey: b.scopeKey,
        usedTokens,
        usedRequests,
        usedCostMicros: usedCost,
        maxTokens: b.maxTokens,
        maxRequests: b.maxRequests,
        maxCostMicros: b.maxCostMicros,
        fraction: Math.max(...fractions),
      };
      usage.push(u);
      if (u.fraction >= 1 && !blockReason) {
        blockReason = `${b.agentKey ? `${b.agentKey} agent` : 'AI'} ${b.period.toLowerCase()} budget reached`;
      }
    }
    return {
      ok: !blockReason,
      reason: blockReason,
      warnings: usage.filter((u) => u.fraction >= 0.8 && u.fraction < 1),
      usage,
    };
  }

  list(companyId: string | null) {
    return this.prisma.aiBudget.findMany({
      where: { scopeKey: { in: companyId ? [GLOBAL, companyId] : [GLOBAL] } },
      orderBy: [{ scopeKey: 'asc' }, { agentKey: 'asc' }, { period: 'asc' }],
    });
  }

  async set(
    scopeKey: string,
    input: {
      agentKey?: string;
      period: AiBudgetPeriod;
      maxTokens?: number | null;
      maxRequests?: number | null;
      maxCostMicros?: number | null;
      enabled?: boolean;
    },
    actor: { identityId: string },
  ) {
    for (const k of ['maxTokens', 'maxRequests', 'maxCostMicros'] as const) {
      const v = input[k];
      if (v != null && (!Number.isInteger(v) || v < 0))
        throw new BadRequestException(
          `${k} must be a non-negative whole number`,
        );
    }
    const agentKey = input.agentKey ?? '';
    // A company may never be given more than the global default allows.
    if (scopeKey !== GLOBAL) {
      const global = await this.prisma.aiBudget.findUnique({
        where: {
          scopeKey_agentKey_period: {
            scopeKey: GLOBAL,
            agentKey,
            period: input.period,
          },
        },
      });
      for (const k of ['maxTokens', 'maxRequests', 'maxCostMicros'] as const) {
        const g = global?.[k];
        const v = input[k];
        if (g != null && (v == null || v > g))
          throw new BadRequestException(
            `${k} cannot exceed the platform limit (${g})`,
          );
      }
    }
    const row = await this.prisma.aiBudget.upsert({
      where: {
        scopeKey_agentKey_period: { scopeKey, agentKey, period: input.period },
      },
      update: {
        maxTokens: input.maxTokens,
        maxRequests: input.maxRequests,
        maxCostMicros: input.maxCostMicros,
        enabled: input.enabled ?? true,
      },
      create: {
        scopeKey,
        agentKey,
        period: input.period,
        maxTokens: input.maxTokens,
        maxRequests: input.maxRequests,
        maxCostMicros: input.maxCostMicros,
        enabled: input.enabled ?? true,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: scopeKey === GLOBAL ? undefined : scopeKey,
      action: 'ai.budget_changed',
      entityType: 'AiBudget',
      entityId: row.id,
      metadata: { scope: scopeKey, agentKey, period: input.period },
    });
    return row;
  }
}
