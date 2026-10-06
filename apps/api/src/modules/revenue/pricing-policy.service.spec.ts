import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingPolicyService } from './pricing-policy.service';

describe('PricingPolicyService', () => {
  let service: PricingPolicyService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const tenantPolicy = {
    id: 'pp1',
    companyId: 'company-a',
    minAbsoluteMargin: 20_000,
    minPercentMargin: 4,
    maxDiscountPercent: 10,
    productOverrides: { FLIGHT: { minAbsolute: 5_000, maxDiscountPercent: 3 } },
  };
  const platformPolicy = {
    id: 'pp0',
    companyId: null,
    minAbsoluteMargin: 1_000,
    minPercentMargin: null,
    maxDiscountPercent: 50,
    productOverrides: null,
  };

  beforeEach(async () => {
    prisma = {
      pricingPolicy: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PricingPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(PricingPolicyService);
  });

  describe('effectivePolicy', () => {
    it("the tenant's own policy beats the platform one, and a product override beats both for that product", async () => {
      prisma.pricingPolicy.findFirst.mockImplementation(
        ({ where }: { where: { companyId: string | null } }) =>
          Promise.resolve(
            where.companyId === 'company-a' ? tenantPolicy : platformPolicy,
          ),
      );
      expect(await service.effectivePolicy('company-a', 'HOTEL')).toEqual({
        minAbsolute: 20_000,
        minPercent: 4,
        maxDiscountPercent: 10,
      });
      expect(await service.effectivePolicy('company-a', 'flight')).toEqual({
        minAbsolute: 5_000,
        minPercent: 4,
        maxDiscountPercent: 3,
      });
    });
    it('falls back to the platform policy, and to nothing at all when none exists', async () => {
      prisma.pricingPolicy.findFirst.mockImplementation(
        ({ where }: { where: { companyId: string | null } }) =>
          Promise.resolve(where.companyId === null ? platformPolicy : null),
      );
      expect(
        await service.effectivePolicy('company-z', 'FLIGHT'),
      ).toMatchObject({ minAbsolute: 1_000, maxDiscountPercent: 50 });
      prisma.pricingPolicy.findFirst.mockResolvedValue(null);
      expect(
        await service.effectivePolicy('company-z', 'FLIGHT'),
      ).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('creates, then audits, a new policy', async () => {
      prisma.pricingPolicy.findFirst.mockResolvedValue(null);
      prisma.pricingPolicy.create.mockResolvedValue({
        id: 'new',
        companyId: 'company-a',
      });
      await service.upsert(
        {
          minAbsoluteMargin: 10_000,
          productOverrides: { flight: { minPercent: 5 } },
        },
        'company-a',
        'id-1',
      );
      expect(prisma.pricingPolicy.create.mock.calls[0][0].data).toMatchObject({
        companyId: 'company-a',
        minAbsoluteMargin: 10_000,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'revenue.policy_updated' }),
      );
    });
    it('records the previous value when updating an existing policy', async () => {
      prisma.pricingPolicy.findFirst.mockResolvedValue(tenantPolicy);
      prisma.pricingPolicy.update.mockResolvedValue({
        ...tenantPolicy,
        minAbsoluteMargin: 1,
      });
      await service.upsert({ minAbsoluteMargin: 1 }, 'company-a', 'id-1');
      expect(audit.record.mock.calls[0][0].previousValue).toMatchObject({
        id: 'pp1',
      });
    });
    it('rejects malformed product overrides (negative, over 100%, not an object)', async () => {
      for (const bad of [
        { FLIGHT: { minPercent: 150 } },
        { FLIGHT: { minAbsolute: -5 } },
        { FLIGHT: 'x' },
      ]) {
        await expect(
          service.upsert({ productOverrides: bad }, 'company-a', 'id-1'),
        ).rejects.toThrow(BadRequestException);
      }
    });
  });
});
