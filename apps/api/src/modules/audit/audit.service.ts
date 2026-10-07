import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface RecordAuditEntry {
  identityId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  // Phase 11 spec #25 — tenant/branch context, and a reason + before/after
  // snapshot for the rows that represent a decision (approvals, settings
  // changes, role changes). All optional — most routine create/read
  // entries have no "previous state" to speak of.
  companyId?: string;
  branchId?: string;
  reason?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
}

export interface AuditSearchFilters {
  from?: Date;
  to?: Date;
  identityId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  branchId?: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: RecordAuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        identityId: entry.identityId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        companyId: entry.companyId,
        branchId: entry.branchId,
        reason: entry.reason,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
      },
    });
  }

  /**
   * One entity's history. Both identifiers are required (an absent filter used to mean "every row of
   * every tenant"), and non-SUPER_ADMIN callers only ever see rows of their own company.
   */
  async listForEntity(
    entityType: string,
    entityId: string,
    tenantCompanyId?: string,
  ) {
    if (!entityType || !entityId) {
      throw new BadRequestException('entityType and entityId are required');
    }
    return this.prisma.auditLog.findMany({
      where: {
        entityType,
        entityId,
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Phase 11 spec #26 — the admin audit-search interface. `tenantCompanyId`
   * follows the same resolveTenantFilter(user) convention as every other
   * tenant-scoped list in this codebase: undefined (SUPER_ADMIN) means no
   * filter, any other value is applied literally. Audit logs are never
   * editable through this or any other path — this method is read-only by
   * construction (no update/delete method exists on this service at all).
   */
  async search(filters: AuditSearchFilters, tenantCompanyId?: string) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
        ...(filters.identityId && { identityId: filters.identityId }),
        ...(filters.action && { action: { contains: filters.action } }),
        ...(filters.entityType && { entityType: filters.entityType }),
        ...(filters.entityId && { entityId: filters.entityId }),
        ...(filters.ipAddress && { ipAddress: filters.ipAddress }),
        ...(filters.branchId && { branchId: filters.branchId }),
        ...((filters.from || filters.to) && {
          createdAt: {
            ...(filters.from && { gte: filters.from }),
            ...(filters.to && { lte: filters.to }),
          },
        }),
      },
      include: {
        identity: { select: { email: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor && {
        cursor: { id: filters.cursor },
        skip: 1,
      }),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
