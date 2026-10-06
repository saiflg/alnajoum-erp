import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { CrmReportsService } from './crm-reports.service';

function setup() {
  const mock = createPrismaMock();
  const service = new CrmReportsService(
    mock.prisma as never,
    new AnalyticsScopeService(mock.prisma as never),
  );
  return { ...mock, service };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');
const manager = authUser(['BRANCH_MANAGER'], 'co-A');

describe('CrmReportsService — tenant isolation', () => {
  describe('staffPerformance (GET /crm/reports/staff/:staffId)', () => {
    it('every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
      await service.staffPerformance(admin, 'st-1');
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a staff member of another company is a 404 and nothing about them is read', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.staffPerformance(admin, 'staff-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'staff-of-B', companyId: 'co-A' },
      });
      expect(calls().map((c) => c.name)).toEqual(['staff.findFirst']);
    });

    it('a branch manager cannot read staff of another branch (404)', async () => {
      const { service, prisma } = setup();
      prisma.staff.findUnique.mockResolvedValue({
        branchId: 'br-9',
        companyId: 'co-A',
      });
      prisma.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.staffPerformance(manager, 'staff-in-other-branch'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
        where: {
          id: 'staff-in-other-branch',
          companyId: 'co-A',
          branchId: 'br-9',
        },
      });
    });

    it('the /me variant works for a staff member with no branch, and is still tenant-scoped', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({ id: 'me' });
      await service.staffPerformance(
        authUser(['STAFF'], 'co-A'),
        'me',
        {},
        true,
      );
      expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'me', companyId: 'co-A' },
      });
      expect(prisma.staff.findFirst.mock.calls[0][0]).not.toMatchObject({
        where: { branchId: expect.anything() },
      });
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('SUPER_ADMIN keeps the platform-wide view', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
      await service.staffPerformance(authUser(['SUPER_ADMIN'], null), 'st-1');
      expectNoQueryMentions(calls(), 'companyId');
    });
  });

  describe('customerValue (GET /crm/reports/customer-value/:customerId)', () => {
    it('every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
      prisma.invoice.findMany.mockResolvedValue([
        { payments: [{ amount: 30 }, { amount: 20 }] },
      ]);
      const result = await service.customerValue(admin, 'c-1');
      expect(result.totalSpending).toBe(50);
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a customer of another company is a 404 and nothing about them is read', async () => {
      const { service, prisma, calls } = setup();
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(
        service.customerValue(admin, 'customer-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.customer.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'customer-of-B', companyId: 'co-A' },
      });
      expect(calls().map((c) => c.name)).toEqual(['customer.findFirst']);
    });
  });

  describe('staffDashboard (GET /crm/reports/dashboard/me)', () => {
    it('every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
      await service.staffDashboard(admin, 'st-1', true);
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });
  });

  describe('branchDashboard (GET /crm/reports/dashboard/branch/:branchId)', () => {
    it('every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.branch.findFirst.mockResolvedValue({ id: 'br-1', name: 'K' });
      await service.branchDashboard(admin, 'br-1');
      expectEveryQueryTenantScoped(calls(), 'co-A');
      expect(prisma.flightBooking.aggregate.mock.calls[0][0]).toMatchObject({
        where: { branchId: 'br-1', customer: { companyId: 'co-A' } },
      });
    });

    it('a branch of another company is a 404 and no figures are read', async () => {
      const { service, prisma, ran } = setup();
      prisma.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.branchDashboard(admin, 'branch-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.branch.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'branch-of-B', companyId: 'co-A' },
      });
      expect(ran('lead.count')).toBe(0);
      expect(ran('flightBooking.aggregate')).toBe(0);
    });

    it('a branch manager cannot open another branch of their own company (404)', async () => {
      const { service, prisma, ran } = setup();
      prisma.staff.findUnique.mockResolvedValue({
        branchId: 'br-9',
        companyId: 'co-A',
      });
      await expect(
        service.branchDashboard(manager, 'br-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ran('lead.count')).toBe(0);
    });
  });

  describe('companyDashboard (GET /crm/reports/dashboard/company)', () => {
    it('every query (customers, leads, tickets, campaigns via staff) carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findMany.mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }]);
      await service.companyDashboard(admin);
      // Campaign has no tenant column: it is bound by the id list of this
      // company's staff (the staff query above is tenant-keyed), asserted below.
      expectEveryQueryTenantScoped(calls(), 'co-A', ['campaign.count']);
      expect(prisma.campaign.count.mock.calls[0][0]).toMatchObject({
        where: { status: 'ACTIVE', createdByStaffId: { in: ['st-1', 'st-2'] } },
      });
      expect(prisma.customer.count.mock.calls[0][0]).toMatchObject({
        where: { companyId: 'co-A' },
      });
    });

    it('a caller with no company is refused, not shown everything', async () => {
      const { service, ran } = setup();
      await expect(
        service.companyDashboard(authUser(['COMPANY_ADMIN'], null)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ran('customer.count')).toBe(0);
    });

    it('SUPER_ADMIN keeps the platform-wide counts', async () => {
      const { service, calls } = setup();
      await service.companyDashboard(authUser(['SUPER_ADMIN'], null));
      expectNoQueryMentions(calls(), 'companyId');
    });
  });
});
