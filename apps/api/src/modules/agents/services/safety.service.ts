import { Injectable, Logger } from '@nestjs/common';
import { AiSafetyEventKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { maskDeep } from '../runtime/guards';

const SEVERITY: Record<
  AiSafetyEventKind,
  'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
> = {
  PROMPT_INJECTION: 'MEDIUM',
  UNAUTHORIZED_ACTION: 'HIGH',
  APPROVAL_BYPASS: 'HIGH',
  SECRET_REQUEST: 'HIGH',
  TENANT_ESCAPE: 'HIGH',
  POLICY_VIOLATION: 'MEDIUM',
  LOOP_DETECTED: 'MEDIUM',
  BUDGET_EXCEEDED: 'LOW',
  UNVERIFIED_NUMBER: 'LOW',
  KILL_SWITCH: 'MEDIUM',
};

export interface SafetyInput {
  kind: AiSafetyEventKind;
  companyId: string | null;
  executionId?: string | null;
  agentKey?: string | null;
  identityId?: string | null;
  evidence: Record<string, unknown>;
}

/**
 * Records attempts that should not happen (an agent asking for a tool it may not use, a message trying to
 * override the rules, a request for a secret...). HIGH events also land in the Phase 22 security incident
 * register, but at most one open incident per (company, kind) per day so a flood of attempts is one incident.
 */
@Injectable()
export class AiSafetyService {
  private readonly logger = new Logger(AiSafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(input: SafetyInput) {
    const severity = SEVERITY[input.kind];
    try {
      const evidence = maskDeep(input.evidence) as Prisma.InputJsonValue;
      let incidentId: string | undefined;
      if (severity === 'HIGH' || severity === 'CRITICAL') {
        incidentId = await this.escalate(input, severity);
      }
      const event = await this.prisma.aiSafetyEvent.create({
        data: {
          companyId: input.companyId ?? undefined,
          executionId: input.executionId ?? undefined,
          agentKey: input.agentKey ?? undefined,
          identityId: input.identityId ?? undefined,
          kind: input.kind,
          severity,
          evidence,
          securityIncidentId: incidentId,
        },
      });
      await this.audit.record({
        identityId: input.identityId ?? undefined,
        companyId: input.companyId ?? undefined,
        action: `ai.safety.${input.kind.toLowerCase()}`,
        entityType: 'AiSafetyEvent',
        entityId: event.id,
        metadata: { agent: input.agentKey ?? null, severity },
      });
      return event;
    } catch (err) {
      // Safety bookkeeping must never take the request down, but it must not vanish silently either.
      this.logger.error(
        `Could not record AI safety event ${input.kind}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async escalate(
    input: SafetyInput,
    severity: 'HIGH' | 'CRITICAL',
  ): Promise<string | undefined> {
    const title = `AI safety: ${input.kind.replace(/_/g, ' ').toLowerCase()}`;
    const since = new Date(Date.now() - 24 * 3600_000);
    const existing = await this.prisma.securityIncident.findFirst({
      where: {
        companyId: input.companyId ?? null,
        title,
        status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const reporter = input.identityId;
    if (!reporter) return undefined;
    const incident = await this.prisma.securityIncident.create({
      data: {
        companyId: input.companyId ?? undefined,
        title,
        description: `An AI agent run (${input.agentKey ?? 'unknown agent'}) triggered a ${input.kind} safety event. Review the AI safety log for the evidence; attempts are blocked in code, this incident only tracks them.`,
        severity,
        reportedByIdentityId: reporter,
        notes: {
          create: {
            authorIdentityId: reporter,
            body: 'Opened automatically by the AI safety monitor.',
            statusChange: 'OPEN',
          },
        },
      },
      select: { id: true },
    });
    return incident.id;
  }
}
