import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiUsageService } from './ai-usage.service';
import { AiProviderRouter } from './providers/ai-provider.router';

function selection(query: string | null, params: Record<string, number> = {}) {
  return JSON.stringify({ query, params });
}

const superAdmin: AuthContext = {
  sub: 'identity-1',
  type: 'STAFF',
  roles: ['SUPER_ADMIN'],
  permissions: [],
  companyId: null,
  sessionId: null,
};

const companyAdmin: AuthContext = {
  ...superAdmin,
  roles: ['COMPANY_ADMIN'],
  companyId: 'company-a',
};

describe('AiAnalyticsService', () => {
  let service: AiAnalyticsService;
  let prisma: Record<string, any>;
  let aiProviderRouter: { complete: jest.Mock };
  let usageService: { enforceDailyLimit: jest.Mock; log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      flightBooking: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { totalAmount: 0 }, _count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      supplierPayable: { findMany: jest.fn().mockResolvedValue([]) },
      staffIncentive: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      },
      visaDocument: { count: jest.fn().mockResolvedValue(0) },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    aiProviderRouter = { complete: jest.fn() };
    usageService = {
      enforceDailyLimit: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiProviderRouter, useValue: aiProviderRouter },
        { provide: AiUsageService, useValue: usageService },
      ],
    }).compile();

    service = module.get(AiAnalyticsService);
  });

  it('enforces the daily usage limit before calling the AI provider', async () => {
    usageService.enforceDailyLimit.mockRejectedValue(
      new Error('limit reached'),
    );

    await expect(service.ask('anything', companyAdmin)).rejects.toThrow(
      'limit reached',
    );
    expect(aiProviderRouter.complete).not.toHaveBeenCalled();
  });

  it('rejects a query name the provider returns that is not in the registry — the allowlist boundary', async () => {
    aiProviderRouter.complete.mockResolvedValue({
      text: selection('drop_all_tables'),
      provider: 'mock',
      model: 'mock-v1',
    });

    const result = await service.ask('do something malicious', companyAdmin);

    expect(result.matched).toBe(false);
    expect(prisma.flightBooking.aggregate).not.toHaveBeenCalled();
    expect(usageService.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'UNMATCHED' }),
    );
  });

  it('reports unmatched (never fabricates) when the provider finds no match', async () => {
    aiProviderRouter.complete.mockResolvedValue({
      text: selection(null),
      provider: 'mock',
      model: 'mock-v1',
    });

    const result = await service.ask("what's the weather", companyAdmin);

    expect(result.matched).toBe(false);
    expect(usageService.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'UNMATCHED' }),
    );
  });

  it('reports unmatched when the provider returns non-JSON garbage, without throwing', async () => {
    aiProviderRouter.complete.mockResolvedValue({
      text: 'not json at all',
      provider: 'mock',
      model: 'mock-v1',
    });

    const result = await service.ask('anything', companyAdmin);

    expect(result.matched).toBe(false);
  });

  it('logs and rethrows when the AI provider call itself fails', async () => {
    aiProviderRouter.complete.mockRejectedValue(new Error('provider down'));

    await expect(service.ask('anything', companyAdmin)).rejects.toThrow(
      'provider down',
    );
    expect(usageService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ERROR',
        errorMessage: 'provider down',
      }),
    );
  });

  describe('total_ticket_sales', () => {
    it('runs a real tenant-scoped query and returns real numbers, never AI-provided ones', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('total_ticket_sales', { days: 7 }),
        provider: 'mock',
        model: 'mock-v1',
      });
      prisma.flightBooking.aggregate.mockResolvedValue({
        _sum: { totalAmount: 500_000 },
        _count: 4,
      });

      const result = await service.ask('total sales this week', companyAdmin);

      expect(result.matched).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ totalAmount: 500_000, bookingCount: 4 }),
      );
      expect(result.summary).toContain('500,000');
      expect(prisma.flightBooking.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customer: { companyId: 'company-a' },
          }),
        }),
      );
      expect(usageService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'MATCHED',
          matchedQuery: 'total_ticket_sales',
        }),
      );
    });

    it('applies no tenant filter for SUPER_ADMIN', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('total_ticket_sales'),
        provider: 'mock',
        model: 'mock-v1',
      });

      await service.ask('total sales', superAdmin);

      const call = prisma.flightBooking.aggregate.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('customer');
    });

    it('clamps an out-of-range param before running the query', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('total_ticket_sales', { days: 99999 }),
        provider: 'mock',
        model: 'mock-v1',
      });

      const result = await service.ask('total sales', companyAdmin);

      expect(result.params).toEqual({ days: 365 });
    });
  });

  describe('supplier_liabilities', () => {
    it('sums amount minus amountPaid across outstanding payables, tenant-scoped', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('supplier_liabilities'),
        provider: 'mock',
        model: 'mock-v1',
      });
      prisma.supplierPayable.findMany.mockResolvedValue([
        { amount: 100_000, amountPaid: 40_000 },
        { amount: 50_000, amountPaid: 0 },
      ]);

      const result = await service.ask(
        'how much do we owe suppliers',
        companyAdmin,
      );

      expect(result.data).toEqual(
        expect.objectContaining({ totalOwed: 110_000, payableCount: 2 }),
      );
      expect(prisma.supplierPayable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });
  });

  describe('pending_incentives', () => {
    it('scopes through staff.companyId', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('pending_incentives'),
        provider: 'mock',
        model: 'mock-v1',
      });

      await service.ask('pending incentives', companyAdmin);

      expect(prisma.staffIncentive.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            staff: { companyId: 'company-a' },
          }),
        }),
      );
    });
  });

  describe('branch_sales', () => {
    it('resolves branch names for the grouped results', async () => {
      aiProviderRouter.complete.mockResolvedValue({
        text: selection('branch_sales'),
        provider: 'mock',
        model: 'mock-v1',
      });
      prisma.flightBooking.groupBy.mockResolvedValue([
        { branchId: 'branch-1', _sum: { totalAmount: 200_000 } },
      ]);
      prisma.branch.findMany.mockResolvedValue([
        { id: 'branch-1', name: 'Kaduna Branch' },
      ]);

      const result = await service.ask('best performing branch', companyAdmin);

      expect(result.data).toEqual(
        expect.objectContaining({
          branches: [{ branch: 'Kaduna Branch', revenue: 200_000 }],
        }),
      );
    });
  });
});
