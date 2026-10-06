import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PromotionsService } from './promotions.service';

function promo(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    companyId: 'company-a',
    name: 'Welcome',
    code: 'SAVE10',
    mode: 'PERCENT',
    value: 10,
    startsAt: new Date('2026-01-01'),
    endsAt: new Date('2099-01-01'),
    isActive: true,
    products: [],
    channels: [],
    minBookingAmount: null,
    maxDiscountAmount: null,
    totalUsageLimit: null,
    perCustomerLimit: null,
    budget: null,
    usedCount: 0,
    budgetUsed: 0,
    ...over,
  };
}

describe('PromotionsService', () => {
  let service: PromotionsService;
  let prisma: any;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      promotion: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      promotionUsage: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    audit = { record: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PromotionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(PromotionsService);
  });

  const body = { product: 'FLIGHT', bookingAmount: 500_000, code: 'save10' };

  describe('create', () => {
    const base = {
      name: 'x',
      mode: 'PERCENT',
      value: 10,
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2027-01-01'),
    };
    it('rejects an end date before the start, and a percentage over 100', async () => {
      await expect(
        service.create(
          { ...base, endsAt: new Date('2025-01-01') } as never,
          'company-a',
          'i',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ ...base, value: 150 } as never, 'company-a', 'i'),
      ).rejects.toThrow(BadRequestException);
    });
    it('rejects a duplicate code within the tenant (no unauthorised cloning)', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      await expect(
        service.create({ ...base, code: 'SAVE10' } as never, 'company-a', 'i'),
      ).rejects.toThrow(ConflictException);
    });
    it('normalises the code and restricts to the creating tenant', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);
      prisma.promotion.create.mockResolvedValue(promo());
      await service.create(
        { ...base, code: 'save10', products: ['flight'] } as never,
        'company-a',
        'i',
      );
      expect(prisma.promotion.create.mock.calls[0][0].data).toMatchObject({
        companyId: 'company-a',
        code: 'SAVE10',
        products: ['FLIGHT'],
      });
    });
  });

  describe('check', () => {
    it("looks the code up only within the caller's tenant, so another tenant's coupon is just 'invalid'", async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);
      const r = await service.check(body, 'company-b');
      expect(prisma.promotion.findFirst.mock.calls[0][0].where).toEqual({
        companyId: 'company-b',
        code: 'SAVE10',
      });
      expect(r).toEqual({ eligible: false, reason: 'CODE_MISMATCH' });
    });
    it('returns the discount for a valid coupon without recording anything', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      const r = await service.check(body, 'company-a');
      expect(r).toMatchObject({ eligible: true, discountAmount: 50_000 });
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });
    it('counts the customer’s earlier redemptions toward the per-customer limit', async () => {
      prisma.promotion.findFirst.mockResolvedValue(
        promo({ perCustomerLimit: 1 }),
      );
      prisma.promotionUsage.count.mockResolvedValue(1);
      const r = await service.check({ ...body, customerId: 'c1' }, 'company-a');
      expect(r).toMatchObject({
        eligible: false,
        reason: 'CUSTOMER_LIMIT_REACHED',
      });
    });
  });

  describe('redeem — atomic and idempotent', () => {
    const dto = {
      ...body,
      sourceType: 'FlightBooking',
      sourceId: 'b1',
      customerId: 'c1',
    };

    it('locks the promotion row, records the usage and increments counters by the real discount', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      prisma.promotion.findUniqueOrThrow.mockResolvedValue(promo());
      prisma.promotionUsage.findUnique.mockResolvedValue(null);
      prisma.promotionUsage.create.mockResolvedValue({
        id: 'u1',
        discountAmount: 50_000,
      });
      await service.redeem(dto, 'company-a', 'id-1');
      expect(prisma.$queryRaw).toHaveBeenCalled(); // SELECT ... FOR UPDATE
      expect(prisma.promotion.update.mock.calls[0][0].data).toEqual({
        usedCount: { increment: 1 },
        budgetUsed: { increment: 50_000 },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'revenue.promotion_redeemed' }),
      );
    });

    it('redeeming the same booking twice returns the first usage and does not double-count', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      prisma.promotionUsage.findUnique.mockResolvedValue({
        id: 'u1',
        discountAmount: 50_000,
      });
      const r = await service.redeem(dto, 'company-a', 'id-1');
      expect(r).toEqual({ id: 'u1', discountAmount: 50_000 });
      expect(prisma.promotion.update).not.toHaveBeenCalled();
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });

    it('refuses a coupon whose usage limit is already reached (reuse abuse)', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      prisma.promotionUsage.findUnique.mockResolvedValue(null);
      prisma.promotion.findUniqueOrThrow.mockResolvedValue(
        promo({ totalUsageLimit: 5, usedCount: 5 }),
      );
      await expect(
        service.redeem(dto as never, 'company-a', 'id-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });

    it('a concurrent identical redemption that loses the unique race gets the winner’s row back', async () => {
      prisma.promotion.findFirst.mockResolvedValue(promo());
      prisma.promotion.findUniqueOrThrow.mockResolvedValue(promo());
      prisma.promotionUsage.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'winner' });
      prisma.promotionUsage.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.redeem(dto as never, 'company-a', 'id-1'),
      ).resolves.toEqual({ id: 'winner' });
    });

    it('needs a code, and an unknown code is a plain 400', async () => {
      await expect(
        service.redeem({ ...dto, code: undefined }, 'company-a', 'id-1'),
      ).rejects.toThrow(BadRequestException);
      prisma.promotion.findFirst.mockResolvedValue(null);
      await expect(
        service.redeem(dto as never, 'company-a', 'id-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
