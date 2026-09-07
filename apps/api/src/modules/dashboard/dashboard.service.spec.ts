import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      staff: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch: { count: jest.fn().mockResolvedValue(0) },
      flightBooking: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      approvalRequest: { count: jest.fn().mockResolvedValue(0) },
      flightRefund: { count: jest.fn().mockResolvedValue(0) },
      staffIncentive: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { count: jest.fn().mockResolvedValue(0) },
      flightSupplier: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  describe('getKpis', () => {
    it("scopes every count to the caller's tenant when one is given", async () => {
      await service.getKpis('company-a');

      expect(prisma.customer.count).toHaveBeenCalledWith({
        where: { companyId: 'company-a' },
      });
      expect(prisma.branch.count).toHaveBeenCalledWith({
        where: { companyId: 'company-a' },
      });
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      await service.getKpis();

      expect(prisma.customer.count).toHaveBeenCalledWith({ where: {} });
    });

    it('defaults flightRevenue to 0 when there is nothing to sum', async () => {
      const result = await service.getKpis('company-a');

      expect(result.flightRevenue).toBe(0);
    });

    it('reports the real sum when there is revenue', async () => {
      prisma.flightBooking.aggregate.mockResolvedValue({
        _sum: { totalAmount: 500_000 },
      });

      const result = await service.getKpis('company-a');

      expect(result.flightRevenue).toBe(500_000);
    });
  });

  describe('globalSearch', () => {
    it('returns empty results for a too-short query rather than querying the DB', async () => {
      const result = await service.globalSearch('a', 'company-a');

      expect(result).toEqual({
        customers: [],
        flightBookings: [],
        staff: [],
        suppliers: [],
      });
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });

    it("scopes customer/staff search to the caller's tenant", async () => {
      await service.globalSearch('okafor', 'company-a');

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });
  });
});
