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

  async resolve(
    user: AuthContext,
    requestedBranchId?: string,
  ): Promise<AnalyticsScope> {
    const tenant = resolveTenantFilter(user);
    if (tenant === '__no_tenant__') {
      throw new ForbiddenException('Your account is not attached to a company');
    }
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
