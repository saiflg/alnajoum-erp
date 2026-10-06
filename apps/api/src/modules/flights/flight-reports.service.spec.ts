import { NotFoundException } from '@nestjs/common';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { FlightReportsService } from './flight-reports.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

function setup() {
  const mock = createPrismaMock();
  const providerLog = new ProviderTransactionLogService(mock.prisma as never);
  const scopes = new AnalyticsScopeService(mock.prisma as never);
  const service = new FlightReportsService(
    mock.prisma as never,
    providerLog,
    scopes,
  );
  return { ...mock, service };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');

describe('FlightReportsService — tenant isolation', () => {
  it('kpis: every query (bookings, refunds, reissues, incentives, provider log) carries the tenant id', async () => {
    const { service, prisma, calls } = setup();
    prisma.branch.findFirst.mockResolvedValue({ id: 'br-1', name: 'Kano' });
    prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
    prisma.flightBooking.findMany.mockResolvedValue([
      { id: 'b1', status: 'TICKETED', totalAmount: 100, providerCost: 60 },
    ]);

    const kpis = await service.kpis(admin, {
      branchId: 'br-1',
      staffId: 'st-1',
    });

    expect(kpis.bookings).toBe(1);
    expectEveryQueryTenantScoped(calls(), 'co-A');
    const where = prisma.flightBooking.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      branchId: 'br-1',
      bookedByStaffId: 'st-1',
      customer: { companyId: 'co-A' },
    });
  });

  it('profitReport: every query carries the tenant id', async () => {
    const { service, prisma, calls } = setup();
    prisma.flightBooking.findMany.mockResolvedValue([
      {
        id: 'b1',
        bookingReference: 'R1',
        customer: { firstName: 'A', lastName: 'B' },
        origin: 'LOS',
        destination: 'DXB',
        provider: 'MOCK',
        totalAmount: 100,
        status: 'TICKETED',
        createdAt: new Date(),
        currency: 'NGN',
      },
    ]);
    const rows = await service.profitReport(admin, {});
    expect(rows).toHaveLength(1);
    expectEveryQueryTenantScoped(calls(), 'co-A');
  });

  it('provider-logs: only rows tied to the caller’s own bookings', async () => {
    const { service, prisma, calls } = setup();
    await service.providerLogs(admin, 'MOCK');
    expectEveryQueryTenantScoped(calls(), 'co-A');
    expect(
      prisma.providerTransactionLog.findMany.mock.calls[0][0],
    ).toMatchObject({
      where: { provider: 'MOCK', booking: { customer: { companyId: 'co-A' } } },
    });
  });

  it('provider searches/success-rate are never narrowed by branch (as before) — SUPER_ADMIN with a branch filter still sees them', async () => {
    const { service, prisma } = setup();
    prisma.branch.findFirst.mockResolvedValue({ id: 'br-1', name: 'Kano' });
    await service.kpis(authUser(['SUPER_ADMIN'], null), { branchId: 'br-1' });
    for (const call of [
      ...prisma.providerTransactionLog.findMany.mock.calls,
      ...prisma.providerTransactionLog.groupBy.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain('booking');
    }
  });

  it('a branchId from another company is a 404 and no booking data is read', async () => {
    const { service, prisma, ran } = setup();
    prisma.branch.findFirst.mockResolvedValue(null); // the lookup is tenant-bound, so B's branch is "not found"
    await expect(
      service.kpis(admin, { branchId: 'branch-of-B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'branch-of-B', companyId: 'co-A' },
    });
    expect(ran('flightBooking.findMany')).toBe(0);
  });

  it('a staffId from another company is a 404 and no booking data is read', async () => {
    const { service, prisma, ran } = setup();
    prisma.staff.findFirst.mockResolvedValue(null);
    await expect(
      service.profitReport(admin, { staffId: 'staff-of-B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'staff-of-B', companyId: 'co-A' },
    });
    expect(ran('flightBooking.findMany')).toBe(0);
  });

  it('a branch manager is held to their own branch, whatever branchId they send', async () => {
    const { service, prisma, calls } = setup();
    prisma.staff.findUnique.mockResolvedValue({
      branchId: 'br-9',
      companyId: 'co-A',
    });
    await service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), {});
    expect(prisma.flightBooking.findMany.mock.calls[0][0]).toMatchObject({
      where: { branchId: 'br-9', customer: { companyId: 'co-A' } },
    });
    // the caller's own staff row is looked up by identity id, not by tenant
    expectEveryQueryTenantScoped(calls(), 'co-A', ['staff.findUnique']);

    await expect(
      service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), { branchId: 'br-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a branch manager cannot read another branch’s staff via staffId', async () => {
    const { service, prisma } = setup();
    prisma.staff.findUnique.mockResolvedValue({
      branchId: 'br-9',
      companyId: 'co-A',
    });
    prisma.staff.findFirst.mockResolvedValue(null);
    await expect(
      service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), {
        staffId: 'staff-in-other-branch',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staff.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'staff-in-other-branch',
        companyId: 'co-A',
        branchId: 'br-9',
      },
    });
  });

  it('SUPER_ADMIN keeps the platform-wide view: no tenant filter is added', async () => {
    const { service, calls } = setup();
    await service.kpis(authUser(['SUPER_ADMIN'], null), {});
    await service.profitReport(authUser(['SUPER_ADMIN'], null), {});
    await service.providerLogs(authUser(['SUPER_ADMIN'], null));
    expectNoQueryMentions(calls(), 'companyId');
  });
});
