import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { AnalyticsScopeService, NO_BRANCH } from './analytics-scope.service';

const user = (
  roles: string[],
  companyId: string | null = 'co-A',
): AuthContext =>
  ({
    sub: 'id-1',
    type: 'STAFF',
    roles,
    permissions: [],
    companyId,
    sessionId: null,
  }) as unknown as AuthContext;

function setup(opts: { staff?: unknown; branch?: unknown } = {}) {
  const prisma = {
    staff: { findUnique: jest.fn().mockResolvedValue(opts.staff ?? null) },
    branch: { findFirst: jest.fn().mockResolvedValue(opts.branch ?? null) },
  };
  return { prisma, svc: new AnalyticsScopeService(prisma as never) };
}

describe('AnalyticsScopeService', () => {
  it('SUPER_ADMIN is platform-wide', async () => {
    const { svc } = setup();
    const s = await svc.resolve(user(['SUPER_ADMIN'], null));
    expect(s.companyId).toBeUndefined();
    expect(s.branchId).toBeUndefined();
  });

  it('a company admin is confined to their own company from the TOKEN', async () => {
    const { svc } = setup();
    const s = await svc.resolve(user(['COMPANY_ADMIN']));
    expect(s).toMatchObject({
      companyId: 'co-A',
      branchId: undefined,
      branchLocked: false,
    });
  });

  it('a caller with no company and no super-admin role is refused outright', async () => {
    const { svc } = setup();
    await expect(
      svc.resolve(user(['COMPANY_ADMIN'], null)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a company admin may pick a branch that belongs to their company', async () => {
    const { svc, prisma } = setup({ branch: { id: 'br-1', name: 'Kano' } });
    const s = await svc.resolve(user(['COMPANY_ADMIN']), 'br-1');
    expect(s.branchId).toBe('br-1');
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'br-1', companyId: 'co-A' } }),
    );
  });

  it("another company's branch is a 404, never revealed (and the lookup is tenant-bound)", async () => {
    const { svc, prisma } = setup({ branch: null });
    await expect(
      svc.resolve(user(['COMPANY_ADMIN']), 'br-of-company-B'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.findFirst.mock.calls[0][0].where.companyId).toBe(
      'co-A',
    );
  });

  it('a branch manager is locked to their own branch', async () => {
    const { svc } = setup({ staff: { branchId: 'br-9', companyId: 'co-A' } });
    const s = await svc.resolve(user(['BRANCH_MANAGER']));
    expect(s).toMatchObject({
      companyId: 'co-A',
      branchId: 'br-9',
      branchLocked: true,
    });
  });

  it("a branch manager asking for a different branch gets a 404, not someone else's data", async () => {
    const { svc } = setup({ staff: { branchId: 'br-9', companyId: 'co-A' } });
    await expect(
      svc.resolve(user(['BRANCH_MANAGER']), 'br-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a branch manager may name their own branch explicitly', async () => {
    const { svc } = setup({ staff: { branchId: 'br-9', companyId: 'co-A' } });
    expect((await svc.resolve(user(['BRANCH_MANAGER']), 'br-9')).branchId).toBe(
      'br-9',
    );
  });

  it('a branch-locked staff member with no branch sees nothing (sentinel), not the whole company', async () => {
    const { svc } = setup({ staff: { branchId: null, companyId: 'co-A' } });
    expect((await svc.resolve(user(['BRANCH_MANAGER']))).branchId).toBe(
      NO_BRANCH,
    );
  });

  it('a non-company-wide role whose staff record is missing or in another company is refused', async () => {
    await expect(
      setup({ staff: null }).svc.resolve(user(['STAFF'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setup({ staff: { branchId: 'b', companyId: 'co-B' } }).svc.resolve(
        user(['STAFF']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AnalyticsScopeService — by-id guards for the legacy report services', () => {
  const mkPrisma = (staff: unknown, customer: unknown) => ({
    staff: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(staff),
    },
    customer: { findFirst: jest.fn().mockResolvedValue(customer) },
    branch: { findFirst: jest.fn() },
  });

  it('tenantOf: SUPER_ADMIN is undefined, others get their token company, no company is refused', () => {
    const svc = new AnalyticsScopeService({} as never);
    expect(svc.tenantOf(user(['SUPER_ADMIN'], null))).toBeUndefined();
    expect(svc.tenantOf(user(['COMPANY_ADMIN'], 'co-A'))).toBe('co-A');
    expect(() => svc.tenantOf(user(['COMPANY_ADMIN'], null))).toThrow(
      ForbiddenException,
    );
  });

  it('assertStaffInScope looks the staff member up inside the caller’s company', async () => {
    const prisma = mkPrisma({ id: 's1' }, null);
    const svc = new AnalyticsScopeService(prisma as never);
    await svc.assertStaffInScope(
      { companyId: 'co-A', branchId: undefined, branchLocked: false },
      's1',
    );
    expect(prisma.staff.findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      companyId: 'co-A',
    });
  });

  it('assertStaffInScope also pins a branch-locked caller to their branch', async () => {
    const prisma = mkPrisma({ id: 's1' }, null);
    const svc = new AnalyticsScopeService(prisma as never);
    await svc.assertStaffInScope(
      { companyId: 'co-A', branchId: 'br-9', branchLocked: true },
      's1',
    );
    expect(prisma.staff.findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      companyId: 'co-A',
      branchId: 'br-9',
    });
  });

  it('assertStaffInScope does NOT pin a company-wide caller who merely filtered by branch', async () => {
    const prisma = mkPrisma({ id: 's1' }, null);
    const svc = new AnalyticsScopeService(prisma as never);
    await svc.assertStaffInScope(
      { companyId: 'co-A', branchId: 'br-1', branchLocked: false },
      's1',
    );
    expect(prisma.staff.findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      companyId: 'co-A',
    });
  });

  it('a staff member or customer outside the scope is a 404', async () => {
    const prisma = mkPrisma(null, null);
    const svc = new AnalyticsScopeService(prisma as never);
    const scope = {
      companyId: 'co-A',
      branchId: undefined,
      branchLocked: false,
    };
    await expect(svc.assertStaffInScope(scope, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.assertCustomerInScope(scope, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({
      id: 'x',
      companyId: 'co-A',
    });
  });

  it('SUPER_ADMIN (no company) is not tenant-filtered', async () => {
    const prisma = mkPrisma({ id: 's1' }, { id: 'c1' });
    const svc = new AnalyticsScopeService(prisma as never);
    const scope = {
      companyId: undefined,
      branchId: undefined,
      branchLocked: false,
    };
    await svc.assertStaffInScope(scope, 's1');
    await svc.assertCustomerInScope(scope, 'c1');
    expect(prisma.staff.findFirst.mock.calls[0][0].where).toEqual({ id: 's1' });
    expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
    });
  });
});
