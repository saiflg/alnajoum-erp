import {
  evaluatePromotion,
  PromotionContext,
  PromotionSnapshot,
} from './promotion-evaluator';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function promo(over: Partial<PromotionSnapshot> = {}): PromotionSnapshot {
  return {
    id: 'p1',
    name: 'Welcome',
    code: null,
    mode: 'PERCENT',
    value: 10,
    startsAt: new Date('2026-10-01'),
    endsAt: new Date('2026-12-31'),
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

function ctx(over: Partial<PromotionContext> = {}): PromotionContext {
  return {
    product: 'FLIGHT',
    bookingAmount: 500_000,
    customerUsageCount: 0,
    now: NOW,
    ...over,
  };
}

describe('evaluatePromotion', () => {
  it('applies a percentage discount to the booking amount', () => {
    const r = evaluatePromotion(promo(), ctx());
    expect(r).toMatchObject({ eligible: true, discountAmount: 50_000 });
    if (r.eligible)
      expect(r.discount).toEqual({
        source: 'PROMOTION:p1',
        mode: 'FIXED',
        value: 50_000,
      });
  });

  it('applies a fixed discount', () => {
    expect(
      evaluatePromotion(promo({ mode: 'FIXED', value: 25_000 }), ctx()),
    ).toMatchObject({ eligible: true, discountAmount: 25_000 });
  });

  describe('rejections', () => {
    const reason = (
      p: Partial<PromotionSnapshot>,
      c: Partial<PromotionContext> = {},
    ) => {
      const r = evaluatePromotion(promo(p), ctx(c));
      return r.eligible ? 'ELIGIBLE' : r.reason;
    };

    it('inactive, not started, expired', () => {
      expect(reason({ isActive: false })).toBe('INACTIVE');
      expect(reason({ startsAt: new Date('2027-01-01') })).toBe('NOT_STARTED');
      expect(reason({ endsAt: new Date('2026-01-01') })).toBe('EXPIRED');
    });

    it('wrong product or channel', () => {
      expect(reason({ products: ['HOTEL'] })).toBe('PRODUCT_NOT_ELIGIBLE');
      expect(reason({ channels: ['MOBILE'] }, { channel: 'WEB' })).toBe(
        'CHANNEL_NOT_ELIGIBLE',
      );
      expect(reason({ channels: ['MOBILE'] })).toBe('CHANNEL_NOT_ELIGIBLE'); // unknown channel never matches a restricted promo
      expect(
        reason({ products: ['FLIGHT'], channels: ['WEB'] }, { channel: 'WEB' }),
      ).toBe('ELIGIBLE');
    });

    it('coupon code is required, matched case-insensitively, and a wrong one is rejected', () => {
      expect(reason({ code: 'SAVE10' })).toBe('CODE_REQUIRED');
      expect(reason({ code: 'SAVE10' }, { presentedCode: 'nope' })).toBe(
        'CODE_MISMATCH',
      );
      expect(reason({ code: 'SAVE10' }, { presentedCode: ' save10 ' })).toBe(
        'ELIGIBLE',
      );
    });

    it('minimum booking amount', () => {
      expect(reason({ minBookingAmount: 600_000 })).toBe(
        'BELOW_MINIMUM_BOOKING',
      );
      expect(reason({ minBookingAmount: 500_000 })).toBe('ELIGIBLE');
    });

    it('total and per-customer usage limits (coupon reuse)', () => {
      expect(reason({ totalUsageLimit: 100, usedCount: 100 })).toBe(
        'USAGE_LIMIT_REACHED',
      );
      expect(reason({ perCustomerLimit: 1 }, { customerUsageCount: 1 })).toBe(
        'CUSTOMER_LIMIT_REACHED',
      );
      expect(reason({ perCustomerLimit: 2 }, { customerUsageCount: 1 })).toBe(
        'ELIGIBLE',
      );
    });

    it('exhausted budget', () => {
      expect(reason({ budget: 100_000, budgetUsed: 100_000 })).toBe(
        'BUDGET_EXHAUSTED',
      );
    });
  });

  describe('caps', () => {
    it('caps at the maximum discount amount', () => {
      const r = evaluatePromotion(promo({ maxDiscountAmount: 30_000 }), ctx());
      expect(r).toMatchObject({
        eligible: true,
        discountAmount: 30_000,
        capped: true,
      });
    });

    it('caps at the remaining budget', () => {
      const r = evaluatePromotion(
        promo({ budget: 100_000, budgetUsed: 80_000 }),
        ctx(),
      );
      expect(r).toMatchObject({
        eligible: true,
        discountAmount: 20_000,
        capped: true,
      });
    });

    it('never discounts more than the booking amount (no negative price)', () => {
      const r = evaluatePromotion(
        promo({ mode: 'FIXED', value: 9_999_999 }),
        ctx({ bookingAmount: 1_000 }),
      );
      expect(r).toMatchObject({
        eligible: true,
        discountAmount: 1_000,
        capped: true,
      });
    });
  });
});
