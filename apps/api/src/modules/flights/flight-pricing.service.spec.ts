import { Test, TestingModule } from '@nestjs/testing';
import { CabinClass } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightPricingService } from './flight-pricing.service';

describe('FlightPricingService', () => {
  let service: FlightPricingService;
  let prisma: { flightPricingRule: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { flightPricingRule: { findMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightPricingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(FlightPricingService);
  });

  const context = {
    airlineCode: 'BA',
    origin: 'LOS',
    destination: 'LHR',
    cabinClass: CabinClass.ECONOMY,
    staffId: undefined,
    branchId: undefined,
  };

  describe('applyMarkup', () => {
    it('applies zero markup when no rule matches', () => {
      const result = service.applyMarkup(100_000, null);
      expect(result).toEqual({
        customerPrice: 100_000,
        markupAmount: 0,
        rule: null,
      });
    });

    it('applies a FIXED markup on top of the provider cost', () => {
      const rule = { type: 'FIXED', amount: 5_000, percent: null } as never;
      const result = service.applyMarkup(100_000, rule);
      expect(result.markupAmount).toBe(5_000);
      expect(result.customerPrice).toBe(105_000);
    });

    it('applies a PERCENTAGE markup, rounded', () => {
      const rule = { type: 'PERCENTAGE', amount: null, percent: 7.5 } as never;
      const result = service.applyMarkup(100_000, rule);
      expect(result.markupAmount).toBe(7_500);
      expect(result.customerPrice).toBe(107_500);
    });
  });

  describe('resolveRule', () => {
    it('returns null when no active rule matches the context', async () => {
      prisma.flightPricingRule.findMany.mockResolvedValue([]);
      const rule = await service.resolveRule(context);
      expect(rule).toBeNull();
    });

    it('picks the highest-priority match among several candidates', async () => {
      prisma.flightPricingRule.findMany.mockResolvedValue([
        {
          id: 'global',
          priority: 0,
          airlineCode: null,
          origin: null,
          destination: null,
          cabinClass: null,
          staffId: null,
          branchId: null,
        },
        {
          id: 'route-specific',
          priority: 5,
          airlineCode: null,
          origin: 'LOS',
          destination: 'LHR',
          cabinClass: null,
          staffId: null,
          branchId: null,
        },
      ]);
      const rule = await service.resolveRule(context);
      expect(rule?.id).toBe('route-specific');
    });

    it('excludes a rule whose scope does not match', async () => {
      prisma.flightPricingRule.findMany.mockResolvedValue([
        {
          id: 'other-route',
          priority: 10,
          airlineCode: null,
          origin: 'ABV',
          destination: 'DXB',
          cabinClass: null,
          staffId: null,
          branchId: null,
        },
      ]);
      const rule = await service.resolveRule(context);
      expect(rule).toBeNull();
    });

    it('breaks a priority tie in favor of the more specific rule', async () => {
      prisma.flightPricingRule.findMany.mockResolvedValue([
        {
          id: 'global',
          priority: 0,
          airlineCode: null,
          origin: null,
          destination: null,
          cabinClass: null,
          staffId: null,
          branchId: null,
        },
        {
          id: 'airline-specific',
          priority: 0,
          airlineCode: 'BA',
          origin: null,
          destination: null,
          cabinClass: null,
          staffId: null,
          branchId: null,
        },
      ]);
      const rule = await service.resolveRule(context);
      expect(rule?.id).toBe('airline-specific');
    });
  });
});
