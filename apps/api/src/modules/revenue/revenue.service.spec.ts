import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { PricingPolicyService } from './pricing-policy.service';
import { PromotionsService } from './promotions.service';
import { toCustomerView } from './engine/price-view';
import { RevenueService } from './revenue.service';

const user = (over: Record<string, unknown> = {}) =>
  ({
    sub: 'id-1',
    type: 'STAFF',
    roles: ['COMPANY_ADMIN'],
    permissions: [PERMISSIONS.REVENUE.PRICING_VIEW],
    companyId: 'company-a',
    ...over,
  }) as never;

const ruleRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  companyId: 'company-a',
  name: 'Markup 10%',
  tier: 'PRODUCT',
  priority: 0,
  isActive: true,
  effectiveFrom: null,
  effectiveTo: null,
  currentVersion: 2,
  conditions: {},
  action: { kind: 'MARKUP', mode: 'PERCENT', value: 10 },
  ...over,
});

describe('RevenueService', () => {
  let service: RevenueService;
  let prisma: any;
  let policy: { effectivePolicy: jest.Mock };
  let promotions: { evaluateForPricing: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      pricingRule: { findMany: jest.fn().mockResolvedValue([ruleRow()]) },
      pricingTrace: {
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        findUnique: jest.fn(),
      },
    };
    policy = { effectivePolicy: jest.fn().mockResolvedValue(undefined) };
    promotions = { evaluateForPricing: jest.fn() };
    audit = { record: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RevenueService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingPolicyService, useValue: policy },
        { provide: PromotionsService, useValue: promotions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(RevenueService);
  });

  const dto = { product: 'flight', supplierCost: 500_000, currency: 'ngn' };

  describe('calculation', () => {
    it("prices with the caller's tenant rules plus platform defaults and reports the rule version used", async () => {
      const { result, traceId } = await service.calculate(dto, user());
      expect(prisma.pricingRule.findMany.mock.calls[0][0].where).toEqual({
        isActive: true,
        OR: [{ companyId: 'company-a' }, { companyId: null }],
      });
      expect(result.breakdown).toMatchObject({
        supplierCost: 500_000,
        markup: 50_000,
        customerPrice: 550_000,
        currency: 'NGN',
      });
      expect(result.appliedRules).toEqual([{ id: 'r1', version: 2 }]);
      expect(traceId).toBeUndefined(); // preview: nothing stored
      expect(prisma.pricingTrace.create).not.toHaveBeenCalled();
    });

    it('pins a tenant user to their own company even if the request names another', async () => {
      await service.calculate({ ...dto, companyId: 'company-b' }, user());
      expect(prisma.pricingRule.findMany.mock.calls[0][0].where.OR[0]).toEqual({
        companyId: 'company-a',
      });
    });

    it('lets the super admin choose the tenant', async () => {
      await service.calculate(
        { ...dto, companyId: 'company-b' },
        user({ roles: ['SUPER_ADMIN'], companyId: null }),
      );
      expect(prisma.pricingRule.findMany.mock.calls[0][0].where.OR[0]).toEqual({
        companyId: 'company-b',
      });
    });

    it('a misconfigured stored rule stops pricing (422) instead of being skipped', async () => {
      prisma.pricingRule.findMany.mockResolvedValue([
        ruleRow({ action: { kind: 'MARKUP', mode: 'PERCENT', value: -3 } }),
      ]);
      await expect(service.calculate(dto as never, user())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('a negative supplier cost is rejected as a 400', async () => {
      prisma.pricingRule.findMany.mockResolvedValue([]);
      await expect(
        service.calculate({ ...dto, supplierCost: -1 }, user()),
      ).rejects.toBeTruthy();
    });
  });

  describe('snapshots', () => {
    it('persist stores the full breakdown, trace and exact rule versions, linked to the booking', async () => {
      const { traceId } = await service.calculate(
        {
          ...dto,
          persist: true,
          sourceType: 'FlightBooking',
          sourceId: 'b1',
        },
        user(),
      );
      expect(traceId).toBe('t1');
      const data = prisma.pricingTrace.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        companyId: 'company-a',
        sourceType: 'FlightBooking',
        sourceId: 'b1',
        supplierCost: 500_000,
        customerPrice: 550_000,
        margin: 50_000,
        status: 'OK',
        appliedRules: [{ id: 'r1', version: 2 }],
        createdByIdentityId: 'id-1',
      });
      expect(data.trace.length).toBeGreaterThan(2);
    });
  });

  describe('margin override', () => {
    const lowMargin = {
      ...dto,
      persist: true,
      override: { reason: 'Strategic retention deal' },
    };
    beforeEach(() => {
      prisma.pricingRule.findMany.mockResolvedValue([]);
      policy.effectivePolicy.mockResolvedValue({ minAbsolute: 10_000 });
    });

    it('without the permission an override attempt is refused (403), even if the price is fine', async () => {
      await expect(
        service.calculate(lowMargin as never, user()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a below-margin price is flagged REQUIRES_OVERRIDE when no override is given', async () => {
      const { result } = await service.calculate(
        { ...dto, persist: false },
        user(),
      );
      expect(result.status).toBe('REQUIRES_OVERRIDE');
    });

    it('with the permission and a reason it passes, the approver and reason are stored, and it is audited', async () => {
      const { result } = await service.calculate(
        lowMargin,
        user({
          permissions: [
            PERMISSIONS.REVENUE.PRICING_VIEW,
            PERMISSIONS.REVENUE.PRICE_OVERRIDE,
          ],
        }),
      );
      expect(result.status).toBe('OK');
      expect(prisma.pricingTrace.create.mock.calls[0][0].data).toMatchObject({
        overrideApprovedBy: 'id-1',
        overrideReason: 'Strategic retention deal',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'revenue.margin_override_used',
          reason: 'Strategic retention deal',
        }),
      );
    });
  });

  describe('coupons', () => {
    it('applies a valid coupon as a discount and records its source in the trace', async () => {
      promotions.evaluateForPricing.mockResolvedValue({
        eligible: true,
        discountAmount: 55_000,
        discount: { source: 'PROMOTION:SAVE10', mode: 'FIXED', value: 55_000 },
      });
      const { result } = await service.calculate(
        { ...dto, promotionCode: 'save10' },
        user(),
      );
      expect(result.breakdown.discount).toBe(55_000);
      expect(
        result.trace.some((t) => t.description.includes('PROMOTION:SAVE10')),
      ).toBe(true);
      expect(promotions.evaluateForPricing.mock.calls[0][0]).toBe('company-a'); // tenant-scoped lookup
      expect(promotions.evaluateForPricing.mock.calls[0][2].bookingAmount).toBe(
        550_000,
      ); // evaluated against the subtotal
    });

    it('an invalid or expired coupon fails loudly (400) rather than silently pricing without it', async () => {
      promotions.evaluateForPricing.mockResolvedValue({
        eligible: false,
        reason: 'EXPIRED',
      });
      await expect(
        service.calculate({ ...dto, promotionCode: 'old' }, user()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('trace access', () => {
    it("another tenant's trace is NotFound", async () => {
      prisma.pricingTrace.findUnique.mockResolvedValue({
        id: 't1',
        companyId: 'company-b',
      });
      await expect(service.getTrace('t1', user())).rejects.toThrow(
        NotFoundException,
      );
    });
    it('own tenant and super admin can read it', async () => {
      prisma.pricingTrace.findUnique.mockResolvedValue({
        id: 't1',
        companyId: 'company-a',
      });
      await expect(service.getTrace('t1', user())).resolves.toBeTruthy();
      prisma.pricingTrace.findUnique.mockResolvedValue({
        id: 't1',
        companyId: 'company-b',
      });
      await expect(
        service.getTrace('t1', user({ roles: ['SUPER_ADMIN'] })),
      ).resolves.toBeTruthy();
    });
  });

  describe('customer view never leaks internal figures', () => {
    it('omits supplier cost, markup, margin, rules and trace', async () => {
      const { result } = await service.calculate(dto, user());
      const view = service.customerView(result);
      expect(view).toEqual({
        currency: 'NGN',
        basePrice: 550_000,
        fees: [],
        discount: 0,
        taxes: [],
        total: 550_000,
      });
      const text = JSON.stringify(view);
      for (const secret of [
        'supplierCost',
        'markup',
        'margin',
        'appliedRules',
        'trace',
        'ruleId',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(toCustomerView(result.breakdown)).toEqual(view);
    });
  });
});
