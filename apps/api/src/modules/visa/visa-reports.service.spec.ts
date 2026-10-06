import { NotFoundException } from '@nestjs/common';
import { VisaApplicationStatus } from '@prisma/client';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { VisaReportsService } from './visa-reports.service';

function setup() {
  const mock = createPrismaMock();
  const service = new VisaReportsService(
    mock.prisma as never,
    new AnalyticsScopeService(mock.prisma as never),
  );
  return { ...mock, service };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');

describe('VisaReportsService', () => {
  describe('statusBreakdown', () => {
    it('counts every VisaApplicationStatus value, including those with zero applications', async () => {
      const { service, prisma } = setup();
      prisma.visaApplication.findMany.mockResolvedValue([
        {
          status: VisaApplicationStatus.DRAFT,
          appliedByStaff: null,
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.DRAFT,
          appliedByStaff: null,
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: null,
          assignedStaff: null,
        },
      ]);

      const result = await service.statusBreakdown(admin, {});

      expect(result.total).toBe(3);
      expect(result.byStatus[VisaApplicationStatus.DRAFT]).toBe(2);
      expect(result.byStatus[VisaApplicationStatus.UNDER_REVIEW]).toBe(1);
      expect(result.byStatus[VisaApplicationStatus.EXPIRED]).toBe(0);
      expect(result.byStatus[VisaApplicationStatus.COMPLETED]).toBe(0);
      // Every enum value must be present, not just the ones with a count.
      expect(Object.keys(result.byStatus)).toHaveLength(
        Object.keys(VisaApplicationStatus).length,
      );
    });

    it('filters to a single branch by either applying or assigned staff member', async () => {
      const { service, prisma } = setup();
      prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1', name: 'K' });
      prisma.visaApplication.findMany.mockResolvedValue([
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: { branchId: 'branch-1' },
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: { branchId: 'branch-2' },
          assignedStaff: null,
        },
      ]);

      const result = await service.statusBreakdown(admin, {
        branchId: 'branch-1',
      });

      expect(result.total).toBe(1);
      expect(result.byStatus[VisaApplicationStatus.UNDER_REVIEW]).toBe(1);
    });

    it('passes the customerId and status filters straight through to the query', async () => {
      const { service, prisma } = setup();

      await service.statusBreakdown(admin, {
        customerId: 'cust-1',
        status: VisaApplicationStatus.COMPLETED,
      });

      expect(prisma.visaApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cust-1',
            status: VisaApplicationStatus.COMPLETED,
            // ANDed with the tenant, so another company's customer matches nothing
            customer: { companyId: 'co-A' },
          }),
        }),
      );
    });
  });

  describe('tenant isolation', () => {
    const application = {
      id: 'app-1',
      applicationReference: 'V1',
      customer: { firstName: 'A', lastName: 'B' },
      visaType: 'TOURIST',
      destinationCountry: 'AE',
      totalAmount: 100,
      sellingPriceSnapshot: 100,
      companyCostSnapshot: 60,
      invoice: null,
      status: VisaApplicationStatus.UNDER_REVIEW,
      appliedByStaff: { branchId: 'br-1', firstName: 'S', lastName: 'T' },
      assignedStaff: null,
      createdAt: new Date(),
      currency: 'NGN',
    };

    it('kpis: every query (applications, incentives) carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.branch.findFirst.mockResolvedValue({ id: 'br-1', name: 'K' });
      prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
      prisma.visaApplication.findMany.mockResolvedValue([application]);
      const kpis = await service.kpis(admin, {
        branchId: 'br-1',
        staffId: 'st-1',
      });
      expect(kpis.totalApplications).toBe(1);
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('profitReport: every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.visaApplication.findMany.mockResolvedValue([application]);
      expect(await service.profitReport(admin, {})).toHaveLength(1);
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('statusBreakdown: every query carries the tenant id', async () => {
      const { service, calls } = setup();
      await service.statusBreakdown(admin, {});
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a branchId or staffId from another company is a 404 and no application data is read', async () => {
      const { service, ran } = setup();
      await expect(
        service.kpis(admin, { branchId: 'branch-of-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.profitReport(admin, { staffId: 'staff-of-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.statusBreakdown(admin, { branchId: 'branch-of-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ran('visaApplication.findMany')).toBe(0);
    });

    it('a branch manager is held to their own branch', async () => {
      const { service, prisma } = setup();
      prisma.staff.findUnique.mockResolvedValue({
        branchId: 'br-1',
        companyId: 'co-A',
      });
      prisma.visaApplication.findMany.mockResolvedValue([
        application,
        { ...application, id: 'app-2', appliedByStaff: { branchId: 'br-2' } },
      ]);
      const kpis = await service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), {});
      expect(kpis.totalApplications).toBe(1); // only br-1's application
      await expect(
        service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), {
          branchId: 'br-2',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('SUPER_ADMIN keeps the platform-wide view: no tenant filter is added', async () => {
      const { service, calls } = setup();
      const sa = authUser(['SUPER_ADMIN'], null);
      await service.kpis(sa, {});
      await service.profitReport(sa, {});
      await service.statusBreakdown(sa, {});
      expectNoQueryMentions(calls(), 'companyId');
    });
  });
});
