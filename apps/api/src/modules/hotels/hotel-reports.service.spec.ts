import { NotFoundException } from '@nestjs/common';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { HotelReportsService } from './hotel-reports.service';

function setup() {
  const mock = createPrismaMock();
  const service = new HotelReportsService(
    mock.prisma as never,
    new AnalyticsScopeService(mock.prisma as never),
  );
  return { ...mock, service };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');

describe('HotelReportsService — tenant isolation', () => {
  it('kpis: every query (bookings, refunds, incentives) carries the tenant id', async () => {
    const { service, prisma, calls } = setup();
    prisma.branch.findFirst.mockResolvedValue({ id: 'br-1', name: 'Kano' });
    prisma.staff.findFirst.mockResolvedValue({ id: 'st-1' });
    prisma.hotelBooking.findMany.mockResolvedValue([
      {
        id: 'h1',
        status: 'COMPLETED',
        totalAmount: 100,
        supplierCost: 70,
        city: 'Makkah',
        hotelName: 'H',
      },
    ]);
    const kpis = await service.kpis(admin, {
      branchId: 'br-1',
      staffId: 'st-1',
    });
    expect(kpis.bookings).toBe(1);
    expectEveryQueryTenantScoped(calls(), 'co-A');
    expect(prisma.hotelBooking.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        branchId: 'br-1',
        bookedByStaffId: 'st-1',
        customer: { companyId: 'co-A' },
      },
    });
  });

  it('profitReport: every query carries the tenant id', async () => {
    const { service, prisma, calls } = setup();
    prisma.hotelBooking.findMany.mockResolvedValue([
      {
        id: 'h1',
        bookingReference: 'H1',
        customer: { firstName: 'A', lastName: 'B' },
        hotelName: 'H',
        city: 'Makkah',
        totalAmount: 100,
        status: 'COMPLETED',
        createdAt: new Date(),
        currency: 'NGN',
      },
    ]);
    expect(await service.profitReport(admin, {})).toHaveLength(1);
    expectEveryQueryTenantScoped(calls(), 'co-A');
  });

  it('a branchId from another company is a 404 and no booking data is read', async () => {
    const { service, prisma, ran } = setup();
    await expect(
      service.kpis(admin, { branchId: 'branch-of-B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'branch-of-B', companyId: 'co-A' },
    });
    expect(ran('hotelBooking.findMany')).toBe(0);
  });

  it('a staffId from another company is a 404 and no booking data is read', async () => {
    const { service, ran } = setup();
    await expect(
      service.profitReport(admin, { staffId: 'staff-of-B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ran('hotelBooking.findMany')).toBe(0);
  });

  it('a branch manager is held to their own branch', async () => {
    const { service, prisma } = setup();
    prisma.staff.findUnique.mockResolvedValue({
      branchId: 'br-9',
      companyId: 'co-A',
    });
    await service.kpis(authUser(['BRANCH_MANAGER'], 'co-A'), {});
    expect(prisma.hotelBooking.findMany.mock.calls[0][0]).toMatchObject({
      where: { branchId: 'br-9', customer: { companyId: 'co-A' } },
    });
    await expect(
      service.profitReport(authUser(['BRANCH_MANAGER'], 'co-A'), {
        branchId: 'br-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SUPER_ADMIN keeps the platform-wide view: no tenant filter is added', async () => {
    const { service, calls } = setup();
    await service.kpis(authUser(['SUPER_ADMIN'], null), {});
    await service.profitReport(authUser(['SUPER_ADMIN'], null), {});
    expectNoQueryMentions(calls(), 'companyId');
  });
});
