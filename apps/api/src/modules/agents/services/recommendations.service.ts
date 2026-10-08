import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiRecommendationStatus,
  Prisma,
  TaskPriority,
  TaskRelatedType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TasksService } from '../../crm/tasks.service';
import { Confidence } from '../agent.types';
import { maskDeep } from '../runtime/guards';
import { PriorityFactors, scorePriority } from '../runtime/priority';

export interface RecommendationInput {
  companyId: string;
  branchId?: string | null;
  agentKey: string;
  kind: string;
  /** Identifies the finding itself (e.g. `visa-docs:<applicationId>`): detecting it again is the same row. */
  dedupeKey: string;
  title: string;
  reason: string;
  evidence: { label: string; source: string; value?: unknown }[];
  confidence: Confidence;
  suggestedAction?: Record<string, unknown>;
  factors: PriorityFactors;
  subjectType?: string;
  subjectId?: string;
  dueAt?: Date | null;
}

const RELATED: Record<string, TaskRelatedType> = {
  VISA: 'VISA',
  HAJJ: 'HAJJ',
  UMRAH: 'UMRAH',
  FLIGHT: 'FLIGHT',
  HOTEL: 'HOTEL',
  PAYMENT: 'PAYMENT',
  DOCUMENT: 'DOCUMENT',
  CUSTOMER: 'CUSTOMER',
  LEAD: 'FOLLOW_UP',
};
const PRIORITY_BY_SEVERITY: Record<string, TaskPriority> = {
  CRITICAL: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'NORMAL',
  LOW: 'LOW',
};

/**
 * Recommendations and the exception queue. A finding is identified by its dedupeKey, so a daily scan that sees
 * the same problem again updates ONE row (priority and evidence refresh as the deadline nears) instead of
 * creating another, and a row a person has dismissed or completed is not resurrected by the next scan.
 */
@Injectable()
export class AiRecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
  ) {}

  async upsert(
    input: RecommendationInput,
  ): Promise<{ id: string; created: boolean }> {
    const p = scorePriority(input.factors);
    const evidence = maskDeep(
      input.evidence,
    ) as unknown as Prisma.InputJsonValue;
    const existing = await this.prisma.aiRecommendation.findUnique({
      where: {
        companyId_dedupeKey: {
          companyId: input.companyId,
          dedupeKey: input.dedupeKey,
        },
      },
    });
    if (existing) {
      if (existing.status === 'OPEN' || existing.status === 'ACKNOWLEDGED') {
        await this.prisma.aiRecommendation.update({
          where: { id: existing.id },
          data: {
            priorityScore: p.score,
            severity: p.severity,
            evidence,
            reason: input.reason,
            title: input.title,
            dueAt: input.dueAt ?? null,
          },
        });
      }
      return { id: existing.id, created: false };
    }
    try {
      const row = await this.prisma.aiRecommendation.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          agentKey: input.agentKey,
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          title: input.title,
          reason: input.reason,
          evidence,
          confidence: input.confidence,
          suggestedAction: (input.suggestedAction ?? undefined) as
            Prisma.InputJsonValue | undefined,
          priorityScore: p.score,
          severity: p.severity,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          dueAt: input.dueAt ?? null,
        },
      });
      return { id: row.id, created: true };
    } catch (err) {
      // Two scans racing on the same finding: the loser finds the winner's row.
      if ((err as { code?: string }).code === 'P2002') {
        const again = await this.prisma.aiRecommendation.findUnique({
          where: {
            companyId_dedupeKey: {
              companyId: input.companyId,
              dedupeKey: input.dedupeKey,
            },
          },
        });
        if (again) return { id: again.id, created: false };
      }
      throw err;
    }
  }

  list(
    companyId: string | undefined,
    filters: {
      status?: AiRecommendationStatus;
      severity?: string;
      agentKey?: string;
      branchId?: string | null;
      branchLimitedTo?: string | null;
    },
    take = 200,
  ) {
    return this.prisma.aiRecommendation.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(filters.status
          ? { status: filters.status }
          : {
              status: {
                in: ['OPEN', 'ACKNOWLEDGED'] as AiRecommendationStatus[],
              },
            }),
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.agentKey ? { agentKey: filters.agentKey } : {}),
        // Staff confined to a branch see their branch's findings and company-wide ones, never another branch's.
        ...(filters.branchLimitedTo
          ? { OR: [{ branchId: filters.branchLimitedTo }, { branchId: null }] }
          : {}),
      },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'asc' }],
      take,
    });
  }

  async counts(companyId: string | undefined) {
    const rows = await this.prisma.aiRecommendation.groupBy({
      by: ['severity', 'status'],
      where: companyId ? { companyId } : {},
      _count: { _all: true },
    });
    return rows.map((r) => ({
      severity: r.severity,
      status: r.status,
      count: r._count._all,
    }));
  }

  async setStatus(
    id: string,
    status: AiRecommendationStatus,
    companyId: string | undefined,
    actor: { identityId: string },
  ) {
    const row = await this.prisma.aiRecommendation.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
    });
    if (!row) throw new NotFoundException('Recommendation not found');
    await this.prisma.aiRecommendation.update({
      where: { id },
      data: {
        status,
        resolvedAt:
          status === 'DONE' || status === 'DISMISSED' ? new Date() : null,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: row.companyId,
      action: 'ai.recommendation_status',
      entityType: 'AiRecommendation',
      entityId: id,
      metadata: { status },
    });
    return { id, status };
  }

  /** Turns a recommendation into one staff task (idempotent: a second call returns the same task). */
  async createTask(
    id: string,
    companyId: string | undefined,
    assignedStaffId: string,
    actor: { identityId: string; staffId: string | null },
  ) {
    const row = await this.prisma.aiRecommendation.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
    });
    if (!row) throw new NotFoundException('Recommendation not found');
    if (row.taskId) return { taskId: row.taskId, created: false };
    const staff = await this.prisma.staff.findFirst({
      where: { id: assignedStaffId, companyId: row.companyId, isActive: true },
      select: { id: true },
    });
    if (!staff)
      throw new BadRequestException(
        'That staff member does not exist in this company',
      );
    // Claim first so two clicks make one task.
    const claim = await this.prisma.aiRecommendation.updateMany({
      where: { id, taskId: null },
      data: { taskId: 'pending' },
    });
    if (claim.count === 0) {
      const again = await this.prisma.aiRecommendation.findUnique({
        where: { id },
      });
      return { taskId: again?.taskId ?? null, created: false };
    }
    try {
      const task = await this.tasks.create(
        {
          title: row.title.slice(0, 200),
          description:
            `${row.reason}\n\n(Created from an AI recommendation.)`.slice(
              0,
              2000,
            ),
          relatedType:
            RELATED[row.subjectType ?? ''] ??
            RELATED[row.kind.split('_')[0]] ??
            'FOLLOW_UP',
          relatedId: row.subjectId ?? undefined,
          assignedStaffId,
          dueDate: (
            row.dueAt ?? new Date(Date.now() + 24 * 3600_000)
          ).toISOString(),
          priority: PRIORITY_BY_SEVERITY[row.severity] ?? 'NORMAL',
        } as never,
        actor.staffId ?? undefined,
      );
      await this.prisma.aiRecommendation.update({
        where: { id },
        data: { taskId: task.id, status: 'ACKNOWLEDGED' },
      });
      return { taskId: task.id, created: true };
    } catch (err) {
      await this.prisma.aiRecommendation.updateMany({
        where: { id, taskId: 'pending' },
        data: { taskId: null },
      });
      throw err;
    }
  }
}
