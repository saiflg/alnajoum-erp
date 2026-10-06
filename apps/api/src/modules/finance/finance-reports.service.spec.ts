import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { FinanceReportsService } from './finance-reports.service';

function setup() {
  const mock = createPrismaMock();
  const ledger = { getAccountBalance: jest.fn().mockResolvedValue(0) };
  const investments = {
    position: jest.fn().mockResolvedValue({ totalInvested: 0 }),
  };
  const service = new FinanceReportsService(
    mock.prisma as never,
    ledger as never,
    investments as never,
    new AnalyticsScopeService(mock.prisma as never),
  );
  return { ...mock, service, ledger, investments };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');
const finance = authUser(['FINANCE_OFFICER'], 'co-A');
const manager = authUser(['BRANCH_MANAGER'], 'co-A');
const superAdmin = authUser(['SUPER_ADMIN'], null);

describe('FinanceReportsService — tenant isolation', () => {
  describe('ledger-backed reports (profit-and-loss, cash-flow, dashboard)', () => {
    // The ledger has no companyId, so these cannot be split per tenant and are
    // platform-administrator only (documented in docs/analytics.md).
    it.each([
      ['COMPANY_ADMIN', admin],
      ['FINANCE_OFFICER', finance],
      ['BRANCH_MANAGER', manager],
    ])('%s is refused and the ledger is never queried', async (_n, user) => {
      const { service, calls, ledger, investments } = setup();
      await expect(service.profitAndLoss(user, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.cashFlow(user, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.dashboardKpis(user)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(calls()).toEqual([]);
      expect(ledger.getAccountBalance).not.toHaveBeenCalled();
      expect(investments.position).not.toHaveBeenCalled();
    });

    it('a caller with no company is refused too', async () => {
      const { service } = setup();
      await expect(
        service.profitAndLoss(authUser(['COMPANY_ADMIN'], null), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SUPER_ADMIN still gets the platform-wide figures, unchanged in shape', async () => {
      const { service, prisma } = setup();
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.ledgerAccount.findMany.mockResolvedValue([]);
      const pl = await service.profitAndLoss(superAdmin, {});
      expect(pl).toHaveProperty('netProfit', 0);
      expect(await service.cashFlow(superAdmin, {})).toMatchObject({
        inflow: 0,
        net: 0,
      });
      expect(await service.dashboardKpis(superAdmin)).toHaveProperty(
        'cashFlowNet',
        0,
      );
    });
  });

  describe('branchAccounting (GET /finance/reports/branches)', () => {
    const branch = { id: 'br-1', name: 'Kano' };

    it('lists only the caller’s own branches, and every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.branch.findMany.mockResolvedValue([branch]);
      const rows = await service.branchAccounting(admin);
      expect(rows).toHaveLength(1);
      expect(prisma.branch.findMany.mock.calls[0][0]).toMatchObject({
        where: { isActive: true, companyId: 'co-A' },
      });
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a branch manager sees only their own branch', async () => {
      const { service, prisma } = setup();
      prisma.staff.findUnique.mockResolvedValue({
        branchId: 'br-9',
        companyId: 'co-A',
      });
      await service.branchAccounting(manager);
      expect(prisma.branch.findMany.mock.calls[0][0]).toMatchObject({
        where: { isActive: true, companyId: 'co-A', id: 'br-9' },
      });
    });

    it('SUPER_ADMIN still sees every branch', async () => {
      const { service, prisma, calls } = setup();
      prisma.branch.findMany.mockResolvedValue([branch]);
      await service.branchAccounting(superAdmin);
      expect(prisma.branch.findMany.mock.calls[0][0]).toMatchObject({
        where: { isActive: true },
      });
      expectNoQueryMentions(calls(), 'companyId');
    });
  });

  describe('customerStatement (GET /finance/reports/customer-statement/:customerId)', () => {
    it('every query (customer, invoices, payments, wallet) carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.customer.findFirst.mockResolvedValue({
        firstName: 'A',
        lastName: 'B',
      });
      const result = await service.customerStatement(admin, 'c-1', {});
      expect(result.customer).toBe('A B');
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a customer of another company is a 404 and no statement rows are read', async () => {
      const { service, prisma, calls } = setup();
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(
        service.customerStatement(admin, 'customer-of-B', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.customer.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'customer-of-B', companyId: 'co-A' },
      });
      expect(calls().map((c) => c.name)).toEqual(['customer.findFirst']);
    });
  });

  describe('staffIncentiveStatement (GET /finance/reports/staff-incentive-statement/:staffId)', () => {
    it('every query carries the tenant id', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({
        firstName: 'S',
        lastName: 'T',
        employeeCode: 'E1',
      });
      await service.staffIncentiveStatement(admin, 'st-1');
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('a staff member of another company is a 404 and no incentives are read', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.staffIncentiveStatement(admin, 'staff-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'staff-of-B', companyId: 'co-A' },
      });
      expect(calls().map((c) => c.name)).toEqual(['staff.findFirst']);
    });

    it('a branch manager cannot read another branch’s staff (404)', async () => {
      const { service, prisma } = setup();
      prisma.staff.findUnique.mockResolvedValue({
        branchId: 'br-9',
        companyId: 'co-A',
      });
      await expect(
        service.staffIncentiveStatement(manager, 'staff-in-other-branch'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
        where: {
          id: 'staff-in-other-branch',
          companyId: 'co-A',
          branchId: 'br-9',
        },
      });
    });

    it('the caller’s own statement (self) is still tenant-scoped', async () => {
      const { service, prisma, calls } = setup();
      prisma.staff.findFirst.mockResolvedValue({
        firstName: 'S',
        lastName: 'T',
        employeeCode: 'E1',
      });
      await service.staffIncentiveStatement(
        authUser(['STAFF'], 'co-A'),
        'me-id',
        true,
      );
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });
  });

  describe('transactionProfitability (GET /finance/reports/transaction/:type/:id)', () => {
    it('the lookup is tenant-bound (through the earning staff member)', async () => {
      const { service, prisma, calls } = setup();
      prisma.staffIncentive.findFirst.mockResolvedValue({
        staff: { firstName: 'S', lastName: 'T' },
        amount: 10,
        margin: 40,
        sellingPrice: 100,
        companyCost: 60,
        status: 'PENDING',
      });
      await service.transactionProfitability(admin, 'FLIGHT_BOOKING', 'b-1');
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('another company’s transaction is a 404', async () => {
      const { service } = setup();
      await expect(
        service.transactionProfitability(admin, 'FLIGHT_BOOKING', 'b-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
