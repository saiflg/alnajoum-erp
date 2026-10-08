import { BadRequestException, Injectable } from '@nestjs/common';
import { AiControlKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AutonomyLevel,
  CommunicationPolicy,
  DEFAULT_COMM_POLICY,
  ResolvedControls,
} from '../agent.types';

export const GLOBAL = 'GLOBAL';

export interface SetControlInput {
  kind: AiControlKind;
  targetKey?: string;
  value?: unknown;
  reason?: string;
}

const clampLevel = (n: unknown, fallback: AutonomyLevel): AutonomyLevel => {
  const v = Number(n);
  return Number.isFinite(v)
    ? (Math.max(0, Math.min(5, Math.floor(v))) as AutonomyLevel)
    : fallback;
};

/**
 * The kill switch, per-agent/per-tool switches, the autonomy ceiling, feature flags and the communication
 * policy. Every control exists at two scopes — GLOBAL (Super Admin) and one company (its admin) — and a company
 * can only ever make things STRICTER than the global setting: it can turn things off, lower the ceiling and force
 * approval, never the reverse. Every change is audited with who and why.
 */
@Injectable()
export class AiControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(
    companyId: string | null,
    agentKey: string,
  ): Promise<ResolvedControls> {
    const scopes = companyId ? [GLOBAL, companyId] : [GLOBAL];
    const rows = await this.prisma.aiControl.findMany({
      where: { scopeKey: { in: scopes } },
    });
    const out: ResolvedControls = {
      allDisabled: false,
      agentDisabled: false,
      disabledTools: new Set(),
      autonomousDisabled: false,
      forceApproval: false,
      autonomyCap: 5,
      featureFlags: {},
      commPolicy: { ...DEFAULT_COMM_POLICY },
    };
    for (const r of rows) {
      const on = (r.value as { enabled?: boolean } | null)?.enabled !== false;
      switch (r.kind) {
        case 'ALL_DISABLED':
          if (on) out.allDisabled = true;
          break;
        case 'AGENT_DISABLED':
          if (on && (r.targetKey === agentKey || r.targetKey === '*'))
            out.agentDisabled = true;
          break;
        case 'TOOL_DISABLED':
          if (on) out.disabledTools.add(r.targetKey);
          break;
        case 'AUTONOMOUS_DISABLED':
          if (on) out.autonomousDisabled = true;
          break;
        case 'FORCE_APPROVAL':
          if (on) out.forceApproval = true;
          break;
        case 'AUTONOMY_CAP':
          out.autonomyCap = Math.min(
            out.autonomyCap,
            clampLevel((r.value as { level?: number } | null)?.level, 5),
          ) as AutonomyLevel;
          break;
        case 'FEATURE_FLAG': {
          const flag = r.targetKey;
          const v = on;
          // GLOBAL false wins over a company true; a company can switch a feature off for itself.
          out.featureFlags[flag] =
            flag in out.featureFlags ? out.featureFlags[flag] && v : v;
          break;
        }
        case 'COMM_POLICY':
          out.commPolicy = this.mergePolicy(
            out.commPolicy,
            r.value,
            r.scopeKey,
          );
          break;
      }
    }
    return out;
  }

  /** A company policy may only narrow the global one (fewer channels, smaller window, lower limit, more rules). */
  private mergePolicy(
    base: CommunicationPolicy,
    value: unknown,
    scope: string,
  ): CommunicationPolicy {
    const v = (value ?? {}) as Partial<CommunicationPolicy>;
    if (scope === GLOBAL) return { ...base, ...v } as CommunicationPolicy;
    return {
      channels: v.channels
        ? base.channels.filter((c) => v.channels!.includes(c))
        : base.channels,
      allowedHours: v.allowedHours
        ? {
            start: Math.max(base.allowedHours.start, v.allowedHours.start),
            end: Math.min(base.allowedHours.end, v.allowedHours.end),
          }
        : base.allowedHours,
      maxMessagesPerCustomerPerDay: Math.min(
        base.maxMessagesPerCustomerPerDay,
        v.maxMessagesPerCustomerPerDay ?? Infinity,
      ),
      requireApprovalFor: [
        ...new Set([
          ...base.requireApprovalFor,
          ...(v.requireApprovalFor ?? []),
        ]),
      ],
      prohibitedContent: [
        ...new Set([...base.prohibitedContent, ...(v.prohibitedContent ?? [])]),
      ],
      languages: v.languages
        ? base.languages.filter((l) => v.languages!.includes(l))
        : base.languages,
    };
  }

  list(companyId: string | null) {
    return this.prisma.aiControl.findMany({
      where: { scopeKey: { in: companyId ? [GLOBAL, companyId] : [GLOBAL] } },
      orderBy: [{ scopeKey: 'asc' }, { kind: 'asc' }],
    });
  }

  /**
   * Sets (or switches off, with `value: {enabled:false}`) a control. A company admin may only set controls at
   * their own company scope; `GLOBAL` is Super Admin only (the controller enforces who may ask).
   */
  async set(
    scopeKey: string,
    input: SetControlInput,
    actor: { identityId: string; companyId: string | null },
  ) {
    const targetKey = input.targetKey ?? '';
    if (
      ['AGENT_DISABLED', 'TOOL_DISABLED', 'FEATURE_FLAG'].includes(
        input.kind,
      ) &&
      !targetKey
    )
      throw new BadRequestException('This control needs a target');
    if (input.kind === 'AUTONOMY_CAP') {
      const level = Number(
        (input.value as { level?: number } | undefined)?.level,
      );
      if (!Number.isInteger(level) || level < 0 || level > 5)
        throw new BadRequestException('Autonomy level must be 0–5');
    }
    const value = (input.value ?? { enabled: true }) as Prisma.InputJsonValue;
    const row = await this.prisma.aiControl.upsert({
      where: {
        scopeKey_kind_targetKey: { scopeKey, kind: input.kind, targetKey },
      },
      update: {
        value,
        reason: input.reason,
        setByIdentityId: actor.identityId,
      },
      create: {
        scopeKey,
        kind: input.kind,
        targetKey,
        value,
        reason: input.reason,
        setByIdentityId: actor.identityId,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId:
        scopeKey === GLOBAL ? (actor.companyId ?? undefined) : scopeKey,
      action: 'ai.control_changed',
      entityType: 'AiControl',
      entityId: row.id,
      reason: input.reason,
      metadata: {
        scope: scopeKey,
        kind: input.kind,
        target: targetKey,
        value: input.value as Prisma.InputJsonValue,
      },
    });
    return row;
  }

  async clear(
    scopeKey: string,
    kind: AiControlKind,
    targetKey: string,
    actor: { identityId: string; companyId: string | null },
  ) {
    const res = await this.prisma.aiControl.deleteMany({
      where: { scopeKey, kind, targetKey },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId:
        scopeKey === GLOBAL ? (actor.companyId ?? undefined) : scopeKey,
      action: 'ai.control_cleared',
      entityType: 'AiControl',
      metadata: {
        scope: scopeKey,
        kind,
        target: targetKey,
        removed: res.count,
      },
    });
    return { removed: res.count };
  }
}
