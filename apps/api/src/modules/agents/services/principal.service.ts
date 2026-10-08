import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { RbacService } from '../../rbac/rbac.service';
import { Principal } from '../agent.types';

/** Roles that see their whole company; every other staff role is confined to its branch inside agent tools. */
const COMPANY_WIDE = new Set([
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'FINANCE_OFFICER',
  'AUDITOR',
  'REPORT_VIEWER',
]);

/** Builds the Principal an agent run acts for — always from the live identity, never from anything a model said. */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async fromAuth(user: AuthContext): Promise<Principal> {
    const [staff, customer] = await Promise.all([
      this.prisma.staff.findUnique({
        where: { identityId: user.sub },
        select: { id: true, branchId: true, companyId: true },
      }),
      this.prisma.customer.findUnique({
        where: { identityId: user.sub },
        select: { id: true, companyId: true },
      }),
    ]);
    const roles = user.roles;
    return {
      identityId: user.sub,
      kind: customer ? 'CUSTOMER' : staff ? 'STAFF' : 'STAFF',
      companyId:
        user.companyId ?? staff?.companyId ?? customer?.companyId ?? null,
      branchId: staff?.branchId ?? null,
      customerId: customer?.id ?? null,
      staffId: staff?.id ?? null,
      roles,
      permissions: user.permissions,
      branchLimited: !customer && !roles.some((r) => COMPANY_WIDE.has(r)),
      isSuperAdmin: roles.includes('SUPER_ADMIN'),
    };
  }

  async fromIdentityId(identityId: string): Promise<Principal> {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
      select: { id: true, type: true },
    });
    const access = await this.rbac.getEffectiveAccess(identityId);
    const [staff, customer] = await Promise.all([
      this.prisma.staff.findUnique({
        where: { identityId },
        select: { id: true, branchId: true, companyId: true },
      }),
      this.prisma.customer.findUnique({
        where: { identityId },
        select: { id: true, companyId: true },
      }),
    ]);
    return {
      identityId: identity?.id ?? identityId,
      kind: customer ? 'CUSTOMER' : 'STAFF',
      companyId: staff?.companyId ?? customer?.companyId ?? null,
      branchId: staff?.branchId ?? null,
      customerId: customer?.id ?? null,
      staffId: staff?.id ?? null,
      roles: access.roles,
      permissions: access.permissions,
      branchLimited:
        !customer && !access.roles.some((r) => COMPANY_WIDE.has(r)),
      isSuperAdmin: access.roles.includes('SUPER_ADMIN'),
    };
  }

  /** The scheduler/event principal: acts for a company, holds no identity and no human permissions. */
  system(companyId: string): Principal {
    return {
      identityId: null,
      kind: 'SYSTEM',
      companyId,
      branchId: null,
      customerId: null,
      staffId: null,
      roles: [],
      permissions: [],
      branchLimited: false,
      isSuperAdmin: false,
    };
  }
}
