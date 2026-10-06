import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Roles that legitimately see every branch of their own company. */
const COMPANY_WIDE_ROLES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'FINANCE_OFFICER',
  'AUDITOR',
  'REPORT_VIEWER',
];

/** Sentinel that matches no row, so an unresolvable branch yields nothing rather than everything. */
export const NO_BRANCH = '__no_branch__';

export interface AnalyticsScope {
  /** undefined = platform-wide (SUPER_ADMIN only); otherwise exactly one tenant. */
  companyId: string | undefined;
  /** undefined = every branch the caller may see; otherwise restricted to this branch. */
  branchId: string | undefined;
  /** True when the caller could not choose a different branch (a branch manager). */
  branchLocked: boolean;
  /** Human-readable, for the response header. */
  description: string;
}

/** The part of a scope the legacy per-module report services need. */
export type ReportScope = Pick<
  AnalyticsScope,
  'companyId' | 'branchId' | 'branchLocked'
>;

/**
 * Prisma fragments that tie a row to a tenant. Bookings, tickets, invoices etc.
 * have no `companyId` column — `customer.companyId` (or `staff.companyId`) is how
 * they belong to a company. `undefined` company (SUPER_ADMIN) = no filter.
 */
export const customerTenant = (
  scope: Pick<ReportScope, 'companyId'>,
): { customer?: { companyId: string } } =>
  scope.companyId ? { customer: { companyId: scope.companyId } } : {};

export const staffTenant = (
  scope: Pick<ReportScope, 'companyId'>,
): { staff?: { companyId: string } } =>
  scope.companyId ? { staff: { companyId: scope.companyId } } : {};

/**
 * Phase 20 — decides WHAT DATA a caller's analytics may cover.
 *
 * The audit found that every older report trusts a caller-supplied branchId and
 * that most are not tenant-scoped at all. This service is the fix for analytics:
 *   - the tenant ALWAYS comes from the caller's token (`resolveTenantFilter`),
 *     never from the request;
 *   - a requested branch must belong to that tenant, otherwise it is a 404
 *     (not 403, so a branch id in another company cannot be probed);
 *   - a caller without a company-wide role (e.g. a branch manager) is locked to
 *     their own branch whatever they ask for.
 */
@Injectable()
export class AnalyticsScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenant only (no branch dimension): for reports whose data has no branch
   * (hajj-ops, company-wide CRM counts). `undefined` = SUPER_ADMIN, platform-wide.
   */
  tenantOf(user: AuthContext): string | undefined {
    const tenant = resolveTenantFilter(user);
    if (tenant === '__no_tenant__') {
      throw new ForbiddenException('Your account is not attached to a company');
    }
    return tenant;
  }

  tenantScope(user: AuthContext): ReportScope {
    return {
      companyId: this.tenantOf(user),
      branchId: undefined,
      branchLocked: false,
    };
  }

  /**
   * A staff id taken from a path or query string must belong to the caller's
   * tenant — and, for a branch-locked caller, to their own branch. Anything
   * else is a 404, indistinguishable from an id that does not exist.
   */
  async assertStaffInScope(scope: ReportScope, staffId: string): Promise<void> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: staffId,
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchLocked && scope.branchId
          ? { branchId: scope.branchId }
          : {}),
      },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
  }

  /** Same rule for a customer id: another company's customer is a 404. */
  async assertCustomerInScope(
    scope: ReportScope,
    customerId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
      },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  async resolve(
    user: AuthContext,
    requestedBranchId?: string,
  ): Promise<AnalyticsScope> {
    const tenant = this.tenantOf(user);
    const companyWide = user.roles.some((r) => COMPANY_WIDE_ROLES.includes(r));

    if (!companyWide) {
      // Branch-locked: the branch comes from the caller's own staff record.
      const staff = await this.prisma.staff.findUnique({
        where: { identityId: user.sub },
        select: { branchId: true, companyId: true },
      });
      if (!staff || staff.companyId !== tenant) {
        throw new ForbiddenException(
          'Analytics are available to staff accounts only',
        );
      }
      const ownBranch = staff.branchId ?? NO_BRANCH;
      if (requestedBranchId && requestedBranchId !== ownBranch) {
        // Not their branch: indistinguishable from a branch that does not exist.
        throw new NotFoundException('Branch not found');
      }
      return {
        companyId: tenant,
        branchId: ownBranch,
        branchLocked: true,
        description: staff.branchId
          ? 'Your branch'
          : 'No branch assigned — nothing to show',
      };
    }

    if (!requestedBranchId) {
      return {
        companyId: tenant,
        branchId: undefined,
        branchLocked: false,
        description:
          tenant === undefined ? 'All companies (platform)' : 'Whole company',
      };
    }

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: requestedBranchId,
        ...(tenant ? { companyId: tenant } : {}),
      },
      select: { id: true, name: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return {
      companyId: tenant,
      branchId: branch.id,
      branchLocked: false,
      description: `Branch: ${branch.name}`,
    };
  }
}
