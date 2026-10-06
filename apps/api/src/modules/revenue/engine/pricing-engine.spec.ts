import { MoneyError } from '../../../common/utils/money.util';
import {
  calculatePrice,
  compareRules,
  conditionsMatch,
  PricingEngineError,
} from './pricing-engine';
import { PricingContext, PricingRuleInput, RuleAction } from './pricing.types';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return { product: 'FLIGHT', supplierCost: 500_000, currency: 'NGN', ...over };
}

let seq = 0;
function rule(
  action: RuleAction,
  over: Partial<PricingRuleInput> = {},
): PricingRuleInput {
  seq += 1;
  return {
    id: `r${seq}`,
    name: `Rule ${seq}`,
    version: 1,
    tier: 'PRODUCT',
    priority: 0,
    isActive: true,
    conditions: {},
    action,
    ...over,
  };
}

const markup = (
  value: number,
  mode: 'FIXED' | 'PERCENT' = 'PERCENT',
  over: Partial<PricingRuleInput> = {},
) => rule({ kind: 'MARKUP', mode, value }, over);

describe('pricing engine', () => {
  describe('the worked example from the spec: 500,000 + 50,000 markup + 20,000 channel fee - 10,000 promo + tax', () => {
    it('prices every component and keeps them traceable (1% tax -> 565,600)', () => {
      const result = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [
          markup(50_000, 'FIXED', { name: 'Supplier markup' }),
          rule(
            { kind: 'FEE', feeType: 'CHANNEL', mode: 'FIXED', value: 20_000 },
            { name: 'Channel fee' },
          ),
          rule(
            { kind: 'DISCOUNT', mode: 'FIXED', value: 10_000 },
            { name: 'Promo' },
          ),
          rule(
            { kind: 'TAX', name: 'VAT', ratePercent: 1, inclusive: false },
            { name: 'Tax' },
          ),
        ],
      });
      const b = result.breakdown;
      expect(b.supplierCost).toBe(500_000);
      expect(b.markup).toBe(50_000);
      expect(b.totalFees).toBe(20_000);
      expect(b.discount).toBe(10_000);
      expect(b.netBeforeTax).toBe(560_000);
      expect(b.taxAdded).toBe(5_600); // 1% of 560,000
      expect(b.customerPrice).toBe(565_600);
      expect(result.trace.map((t) => t.step)).toEqual([
        'SUPPLIER_COST',
        'MARKUP',
        'FEE',
        'DISCOUNT',
        'TAX',
        'RESULT',
      ]);
      expect(result.trace.every((t) => t.currency === 'NGN')).toBe(true);
      expect(result.calculatedAt).toBe(NOW.toISOString());
    });
  });

  describe('matches the existing flight markup arithmetic', () => {
    it('PERCENT markup equals Math.round(cost * pct / 100), as FlightPricingService does', () => {
      const r = calculatePrice({
        context: ctx({ supplierCost: 123_457 }),
        now: NOW,
        rules: [markup(12.5)],
      });
      expect(r.breakdown.markup).toBe(Math.round((123_457 * 12.5) / 100));
      expect(r.breakdown.customerPrice).toBe(123_457 + r.breakdown.markup);
    });
    it('with no matching rule the price is the supplier cost, margin zero (same as today)', () => {
      const r = calculatePrice({ context: ctx(), now: NOW, rules: [] });
      expect(r.breakdown.customerPrice).toBe(500_000);
      expect(r.breakdown.margin).toBe(0);
      expect(r.trace[1]).toMatchObject({ step: 'MARKUP', status: 'SKIPPED' });
    });
  });

  describe('rule precedence is explicit and never ambiguous', () => {
    it('a CONTRACT rule beats a higher-priority PRODUCT rule (tier outranks priority)', () => {
      const product = markup(10, 'PERCENT', {
        id: 'prod',
        tier: 'PRODUCT',
        priority: 999,
      });
      const contract = markup(4, 'PERCENT', {
        id: 'corp',
        tier: 'CONTRACT',
        priority: 0,
      });
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [product, contract],
      });
      expect(r.breakdown.markup).toBe(20_000);
      expect(r.appliedRules).toEqual([{ id: 'corp', version: 1 }]);
    });

    it('within a tier, higher priority wins', () => {
      const a = markup(5, 'PERCENT', { id: 'a', priority: 1 });
      const b = markup(8, 'PERCENT', { id: 'b', priority: 5 });
      expect(
        calculatePrice({ context: ctx(), now: NOW, rules: [a, b] }).breakdown
          .markup,
      ).toBe(40_000);
    });

    it('equal priority: the more specific rule wins', () => {
      const broad = markup(5, 'PERCENT', { id: 'broad' });
      const specific = markup(9, 'PERCENT', {
        id: 'specific',
        conditions: { origin: 'LOS', destination: 'ABV' },
      });
      const r = calculatePrice({
        context: ctx({ origin: 'LOS', destination: 'ABV' }),
        now: NOW,
        rules: [broad, specific],
      });
      expect(r.breakdown.markup).toBe(45_000);
    });

    it('equal priority and specificity: the newer version wins; then id breaks any remaining tie', () => {
      const v1 = markup(5, 'PERCENT', { id: 'same', version: 1 });
      const v2 = markup(7, 'PERCENT', { id: 'same', version: 2 });
      expect(
        calculatePrice({ context: ctx(), now: NOW, rules: [v1, v2] }).breakdown
          .markup,
      ).toBe(35_000);

      const x = markup(5, 'PERCENT', { id: 'aaa' });
      const y = markup(9, 'PERCENT', { id: 'bbb' });
      const first = calculatePrice({ context: ctx(), now: NOW, rules: [x, y] });
      const second = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [y, x],
      });
      expect(first.breakdown.markup).toBe(second.breakdown.markup);
      expect(first.breakdown.markup).toBe(25_000); // 'aaa' sorts first
    });

    it('the losing rule is preserved in the trace with the reason it lost', () => {
      const winner = markup(4, 'PERCENT', {
        id: 'win',
        name: 'Corporate deal',
        tier: 'CONTRACT',
      });
      const loser = markup(10, 'PERCENT', {
        id: 'lose',
        name: 'Standard markup',
      });
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [loser, winner],
      });
      const lost = r.trace.find((t) => t.status === 'SUPERSEDED');
      expect(lost).toMatchObject({
        step: 'MARKUP',
        ruleId: 'lose',
        note: expect.stringContaining('Corporate deal'),
      });
      expect(r.appliedRules.map((x) => x.id)).not.toContain('lose');
    });

    it('compareRules is a strict total order for rules with different ids', () => {
      const a = markup(1, 'PERCENT', { id: 'a' });
      const b = markup(1, 'PERCENT', { id: 'b' });
      expect(compareRules(a, b)).toBeLessThan(0);
      expect(compareRules(b, a)).toBeGreaterThan(0);
    });

    it('is deterministic: identical inputs always give an identical result', () => {
      const rules = [
        markup(7),
        rule({ kind: 'FEE', feeType: 'BOOKING', mode: 'FIXED', value: 3_000 }),
      ];
      expect(calculatePrice({ context: ctx(), now: NOW, rules })).toEqual(
        calculatePrice({ context: ctx(), now: NOW, rules }),
      );
    });
  });

  describe('rule eligibility', () => {
    it('ignores inactive, not-yet-effective and expired rules', () => {
      const inactive = markup(50, 'PERCENT', { isActive: false });
      const future = markup(50, 'PERCENT', {
        effectiveFrom: new Date('2027-01-01'),
      });
      const expired = markup(50, 'PERCENT', {
        effectiveTo: new Date('2026-01-01'),
      });
      expect(
        calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [inactive, future, expired],
        }).breakdown.markup,
      ).toBe(0);
    });

    it('matches every condition type', () => {
      const c = ctx({
        origin: 'LOS',
        passengers: 6,
        advanceDays: 20,
        channel: 'MOBILE',
        customerSegment: 'VIP',
      });
      expect(conditionsMatch({ origin: 'LOS', channel: 'MOBILE' }, c)).toBe(
        true,
      );
      expect(conditionsMatch({ origin: 'ABV' }, c)).toBe(false);
      expect(conditionsMatch({ minPassengers: 5, maxPassengers: 9 }, c)).toBe(
        true,
      );
      expect(conditionsMatch({ minPassengers: 10 }, c)).toBe(false);
      expect(
        conditionsMatch({ minAdvanceDays: 14, maxAdvanceDays: 30 }, c),
      ).toBe(true);
      expect(conditionsMatch({ maxAdvanceDays: 7 }, c)).toBe(false);
      expect(conditionsMatch({ customerSegment: 'VIP' }, c)).toBe(true);
      // a bounded condition against an unknown value does NOT match
      expect(conditionsMatch({ minPassengers: 1 }, ctx())).toBe(false);
    });

    it('supports configurable group tiers instead of hard-coded ones (1-4 / 5-9 / 10-19 / 20+)', () => {
      const tiers = [
        markup(10, 'PERCENT', {
          id: 'std',
          conditions: { minPassengers: 1, maxPassengers: 4 },
        }),
        markup(8, 'PERCENT', {
          id: 'g1',
          conditions: { minPassengers: 5, maxPassengers: 9 },
        }),
        markup(6, 'PERCENT', {
          id: 'g2',
          conditions: { minPassengers: 10, maxPassengers: 19 },
        }),
        markup(4, 'PERCENT', { id: 'g3', conditions: { minPassengers: 20 } }),
      ];
      const pct = (passengers: number) =>
        calculatePrice({ context: ctx({ passengers }), now: NOW, rules: tiers })
          .appliedRules[0].id;
      expect([pct(2), pct(7), pct(15), pct(40)]).toEqual([
        'std',
        'g1',
        'g2',
        'g3',
      ]);
    });

    it('a rule for another channel/segment/corporate account is never applied (no leakage between customers)', () => {
      const corpA = markup(2, 'PERCENT', {
        id: 'corpA',
        tier: 'CONTRACT',
        conditions: { corporateAccountId: 'A' },
      });
      const r = calculatePrice({
        context: ctx({ corporateAccountId: 'B' }),
        now: NOW,
        rules: [corpA],
      });
      expect(r.appliedRules).toEqual([]);
      expect(r.breakdown.markup).toBe(0);
    });
  });

  describe('fees', () => {
    it('applies one winning rule per fee type and stacks different types', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [
          markup(10),
          rule(
            { kind: 'FEE', feeType: 'SERVICE', mode: 'PERCENT', value: 2 },
            { id: 'svcLow', priority: 1 },
          ),
          rule(
            { kind: 'FEE', feeType: 'SERVICE', mode: 'PERCENT', value: 3 },
            { id: 'svcHigh', priority: 9 },
          ),
          rule({
            kind: 'FEE',
            feeType: 'BOOKING',
            mode: 'FIXED',
            value: 2_500,
          }),
        ],
      });
      // service fee is 3% of (cost + markup) = 3% of 550,000
      expect(
        r.breakdown.fees.find((f) => f.feeType === 'SERVICE')?.amount,
      ).toBe(16_500);
      expect(
        r.breakdown.fees.find((f) => f.feeType === 'BOOKING')?.amount,
      ).toBe(2_500);
      expect(r.breakdown.totalFees).toBe(19_000);
      expect(
        r.trace.filter((t) => t.step === 'FEE' && t.status === 'SUPERSEDED'),
      ).toHaveLength(1);
    });
  });

  describe('tax', () => {
    it('adds an exclusive tax and reports it separately from revenue', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [
          markup(10),
          rule({
            kind: 'TAX',
            name: 'VAT',
            ratePercent: 7.5,
            inclusive: false,
          }),
        ],
      });
      expect(r.breakdown.netBeforeTax).toBe(550_000);
      expect(r.breakdown.taxAdded).toBe(41_250);
      expect(r.breakdown.customerPrice).toBe(591_250);
      expect(r.breakdown.revenueExTax).toBe(550_000);
      expect(r.breakdown.margin).toBe(50_000);
    });

    it('an inclusive tax is reported but never added, and is excluded from revenue', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [
          markup(10),
          rule({ kind: 'TAX', name: 'VAT', ratePercent: 7.5, inclusive: true }),
        ],
      });
      expect(r.breakdown.customerPrice).toBe(550_000);
      expect(r.breakdown.taxAdded).toBe(0);
      expect(r.breakdown.taxIncluded).toBe(38_372); // 550,000 * 7.5 / 107.5
      expect(r.breakdown.revenueExTax).toBe(550_000 - 38_372);
    });

    it('never double-taxes when the supplier price already includes tax', () => {
      const r = calculatePrice({
        context: ctx({ taxIncludedInSupplierCost: true }),
        now: NOW,
        rules: [
          markup(10),
          rule({
            kind: 'TAX',
            name: 'VAT',
            ratePercent: 7.5,
            inclusive: false,
          }),
        ],
      });
      expect(r.breakdown.taxAdded).toBe(0);
      expect(r.breakdown.customerPrice).toBe(550_000);
      expect(r.trace.find((t) => t.step === 'TAX')).toMatchObject({
        status: 'SKIPPED',
        note: expect.stringContaining('already includes tax'),
      });
    });
  });

  describe('discounts', () => {
    it('stacks only discounts marked stackable; non-stackable ones compete for one slot', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [
          markup(10),
          rule(
            { kind: 'DISCOUNT', mode: 'PERCENT', value: 5 },
            { id: 'd1', priority: 1 },
          ),
          rule(
            { kind: 'DISCOUNT', mode: 'PERCENT', value: 10 },
            { id: 'd2', priority: 9 },
          ),
          rule(
            { kind: 'DISCOUNT', mode: 'FIXED', value: 1_000, stackable: true },
            { id: 'd3' },
          ),
        ],
      });
      // d2 wins the competing slot (10% of 550,000 = 55,000) + the stackable 1,000
      expect(r.breakdown.discount).toBe(56_000);
      expect(
        r.trace
          .filter((t) => t.step === 'DISCOUNT' && t.status === 'SUPERSEDED')
          .map((t) => t.ruleId),
      ).toEqual(['d1']);
    });

    it('applies caller-supplied promotions/coupons and records their source', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10)],
        extraDiscounts: [
          { source: 'COUPON:WELCOME10', mode: 'PERCENT', value: 10 },
        ],
      });
      expect(r.breakdown.discount).toBe(55_000);
      expect(r.trace.find((t) => t.step === 'DISCOUNT')?.description).toContain(
        'COUPON:WELCOME10',
      );
    });

    it('caps total discount at the policy maximum (no coupon stacking abuse)', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10)],
        marginPolicy: { maxDiscountPercent: 5 },
        extraDiscounts: [
          { source: 'COUPON:A', mode: 'PERCENT', value: 10 },
          { source: 'COUPON:B', mode: 'PERCENT', value: 10 },
        ],
      });
      expect(r.breakdown.discount).toBe(27_500); // 5% of 550,000
      expect(
        r.trace.some((t) => t.step === 'DISCOUNT' && t.status === 'CLAMPED'),
      ).toBe(true);
    });

    it('can never produce a negative price, however large the discount', () => {
      const r = calculatePrice({
        context: ctx({ supplierCost: 1_000 }),
        now: NOW,
        rules: [],
        extraDiscounts: [{ source: 'STAFF', mode: 'FIXED', value: 999_999 }],
      });
      expect(r.breakdown.discount).toBe(1_000);
      expect(r.breakdown.customerPrice).toBe(0);
      expect(r.breakdown.customerPrice).toBeGreaterThanOrEqual(0);
    });
  });

  describe('margin protection', () => {
    const policy = { minAbsolute: 30_000, minPercent: 5 };

    it('passes when margin meets every floor', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10)],
        marginPolicy: policy,
      });
      expect(r.status).toBe('OK');
      expect(r.violations).toEqual([]);
    });

    it('blocks (REQUIRES_OVERRIDE) a discount that breaks the absolute floor — never silently allowed', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10)],
        marginPolicy: policy,
        extraDiscounts: [{ source: 'STAFF', mode: 'FIXED', value: 40_000 }],
      });
      expect(r.status).toBe('REQUIRES_OVERRIDE');
      expect(r.violations[0]).toContain('BELOW_MIN_ABSOLUTE_MARGIN');
      expect(r.trace.some((t) => t.step === 'MARGIN')).toBe(true);
    });

    it('enforces the percentage floor too', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(3)],
        marginPolicy: { minPercent: 5 },
      });
      expect(r.status).toBe('REQUIRES_OVERRIDE');
      expect(
        r.violations.some((v) => v.startsWith('BELOW_MIN_PERCENT_MARGIN')),
      ).toBe(true);
    });

    it('always flags a negative margin, even with no policy configured', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [],
        extraDiscounts: [{ source: 'STAFF', mode: 'FIXED', value: 10_000 }],
      });
      expect(r.status).toBe('REQUIRES_OVERRIDE');
      expect(r.violations[0]).toContain('NEGATIVE_MARGIN');
    });

    it('an override with an approver AND a reason is accepted and recorded', () => {
      const r = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10)],
        marginPolicy: policy,
        extraDiscounts: [{ source: 'STAFF', mode: 'FIXED', value: 40_000 }],
        override: {
          approvedBy: 'identity-9',
          reason: 'Strategic corporate retention',
        },
      });
      expect(r.status).toBe('OK');
      const o = r.trace.find((t) => t.step === 'OVERRIDE');
      expect(o?.note).toContain('Strategic corporate retention');
      expect(o?.note).toContain('BELOW_MIN_ABSOLUTE_MARGIN');
    });

    it('an override without a reason (or approver) is ignored', () => {
      for (const override of [
        { approvedBy: 'identity-9', reason: '   ' },
        { approvedBy: '', reason: 'because' },
      ]) {
        const r = calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [markup(10)],
          marginPolicy: policy,
          extraDiscounts: [{ source: 'STAFF', mode: 'FIXED', value: 40_000 }],
          override,
        });
        expect(r.status).toBe('REQUIRES_OVERRIDE');
      }
    });
  });

  describe('controlled dynamic pricing', () => {
    const dyn = (
      over: Partial<Extract<RuleAction, { kind: 'DYNAMIC' }>['limits']> = {},
      bands = [
        { upTo: 7, adjustPercent: 10 },
        { upTo: 30, adjustPercent: 4 },
      ],
    ) =>
      rule(
        {
          kind: 'DYNAMIC',
          signal: 'daysToDeparture',
          bands,
          limits: { maxMovementPercent: 20, ...over },
        },
        { id: 'dyn' },
      );

    it('picks the first matching band for the measured signal', () => {
      const near = calculatePrice({
        context: ctx({ daysToDeparture: 3 }),
        now: NOW,
        rules: [markup(10), dyn()],
      });
      const mid = calculatePrice({
        context: ctx({ daysToDeparture: 20 }),
        now: NOW,
        rules: [markup(10), dyn()],
      });
      expect(near.breakdown.dynamicAdjustment).toBe(55_000); // +10% of 550,000
      expect(mid.breakdown.dynamicAdjustment).toBe(22_000); // +4%
    });

    it('does nothing when the signal is outside every band or not provided', () => {
      const far = calculatePrice({
        context: ctx({ daysToDeparture: 90 }),
        now: NOW,
        rules: [markup(10), dyn()],
      });
      const none = calculatePrice({
        context: ctx(),
        now: NOW,
        rules: [markup(10), dyn()],
      });
      expect(far.breakdown.dynamicAdjustment).toBe(0);
      expect(none.breakdown.dynamicAdjustment).toBe(0);
      expect(none.trace.find((t) => t.step === 'DYNAMIC')?.status).toBe(
        'SKIPPED',
      );
    });

    it('limits price movement to the configured maximum', () => {
      const r = calculatePrice({
        context: ctx({ daysToDeparture: 3 }),
        now: NOW,
        rules: [
          markup(10),
          dyn({ maxMovementPercent: 2 }, [{ upTo: 7, adjustPercent: 15 }]),
        ],
      });
      expect(r.breakdown.dynamicAdjustment).toBe(11_000); // capped at 2% of 550,000
      expect(r.trace.find((t) => t.step === 'DYNAMIC')?.status).toBe('CLAMPED');
    });

    it('respects a maximum total markup over cost', () => {
      const r = calculatePrice({
        context: ctx({ daysToDeparture: 3 }),
        now: NOW,
        rules: [
          markup(10),
          dyn({ maxMarkupPercent: 12 }, [{ upTo: 7, adjustPercent: 15 }]),
        ],
      });
      // markup is already 50,000 (10%); only 2% of cost (10,000) of headroom remains
      expect(r.breakdown.dynamicAdjustment).toBe(10_000);
    });

    it('respects a price ceiling and a price floor', () => {
      const up = calculatePrice({
        context: ctx({ daysToDeparture: 3 }),
        now: NOW,
        rules: [
          markup(10),
          dyn({ maxPrice: 560_000 }, [{ upTo: 7, adjustPercent: 15 }]),
        ],
      });
      expect(up.breakdown.subtotal).toBe(560_000);
      const down = calculatePrice({
        context: ctx({ daysToDeparture: 3 }),
        now: NOW,
        rules: [
          markup(10),
          dyn({ minPrice: 540_000 }, [{ upTo: 7, adjustPercent: -15 }]),
        ],
      });
      expect(down.breakdown.subtotal).toBe(540_000);
    });
  });

  describe('fails safely on bad input', () => {
    it('rejects a negative, fractional or non-finite supplier cost', () => {
      for (const supplierCost of [-5, 10.5, NaN, Infinity]) {
        expect(() =>
          calculatePrice({
            context: ctx({ supplierCost }),
            now: NOW,
            rules: [],
          }),
        ).toThrow(MoneyError);
      }
    });

    it('rejects a missing currency', () => {
      expect(() =>
        calculatePrice({ context: ctx({ currency: '' }), now: NOW, rules: [] }),
      ).toThrow(PricingEngineError);
    });

    it('rejects a rule carrying a negative or absurd value instead of pricing with it', () => {
      expect(() =>
        calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [markup(-10, 'FIXED')],
        }),
      ).toThrow(MoneyError);
      expect(() =>
        calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [markup(5000, 'PERCENT')],
        }),
      ).toThrow(MoneyError);
      expect(() =>
        calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [
            rule({
              kind: 'TAX',
              name: 'VAT',
              ratePercent: 200,
              inclusive: false,
            }),
          ],
        }),
      ).toThrow(MoneyError);
    });

    it('rejects a negative injected discount', () => {
      expect(() =>
        calculatePrice({
          context: ctx(),
          now: NOW,
          rules: [],
          extraDiscounts: [{ source: 'X', mode: 'FIXED', value: -1 }],
        }),
      ).toThrow(MoneyError);
    });
  });
});
