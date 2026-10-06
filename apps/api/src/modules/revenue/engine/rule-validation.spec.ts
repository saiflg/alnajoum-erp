import { PricingEngineError } from './pricing-engine';
import {
  toEngineRule,
  validateAction,
  validateConditions,
  validateTier,
} from './rule-validation';

describe('rule validation', () => {
  describe('conditions', () => {
    it('accepts known conditions and drops null/undefined ones', () => {
      expect(
        validateConditions({
          origin: 'LOS',
          minPassengers: 5,
          maxPassengers: 9,
          channel: null,
        }),
      ).toEqual({
        origin: 'LOS',
        minPassengers: 5,
        maxPassengers: 9,
      });
    });
    it('rejects unknown keys, wrong types and inverted ranges', () => {
      expect(() => validateConditions({ colour: 'red' })).toThrow(
        PricingEngineError,
      );
      expect(() => validateConditions({ origin: 5 })).toThrow(
        PricingEngineError,
      );
      expect(() => validateConditions({ origin: '  ' })).toThrow(
        PricingEngineError,
      );
      expect(() => validateConditions({ minPassengers: -1 })).toThrow(
        PricingEngineError,
      );
      expect(() => validateConditions({ minPassengers: 1.5 })).toThrow(
        PricingEngineError,
      );
      expect(() =>
        validateConditions({ minPassengers: 10, maxPassengers: 5 }),
      ).toThrow(PricingEngineError);
      expect(() => validateConditions('nope')).toThrow(PricingEngineError);
      expect(() => validateConditions([])).toThrow(PricingEngineError);
    });
  });

  describe('actions', () => {
    it('accepts valid markup, fee, discount and tax actions (normalising names)', () => {
      expect(
        validateAction({ kind: 'MARKUP', mode: 'PERCENT', value: 7.5 }),
      ).toEqual({ kind: 'MARKUP', mode: 'PERCENT', value: 7.5 });
      expect(
        validateAction({
          kind: 'FEE',
          feeType: ' service ',
          mode: 'FIXED',
          value: 2_000,
        }),
      ).toMatchObject({ feeType: 'SERVICE' });
      expect(
        validateAction({ kind: 'DISCOUNT', mode: 'FIXED', value: 500 }),
      ).toMatchObject({ stackable: false });
      expect(
        validateAction({
          kind: 'TAX',
          name: 'vat',
          ratePercent: 7.5,
          inclusive: true,
        }),
      ).toMatchObject({ name: 'VAT' });
    });

    it('rejects negative, fractional-fixed and absurd values (negative-price injection)', () => {
      expect(() =>
        validateAction({ kind: 'MARKUP', mode: 'FIXED', value: -1 }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'MARKUP', mode: 'FIXED', value: 10.5 }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'MARKUP', mode: 'PERCENT', value: 5_000 }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'DISCOUNT', mode: 'PERCENT', value: NaN }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'MARKUP', mode: 'WHATEVER', value: 1 }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({
          kind: 'TAX',
          name: 'VAT',
          ratePercent: 150,
          inclusive: false,
        }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'TAX', name: 'VAT', ratePercent: 7.5 }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({ kind: 'FEE', mode: 'FIXED', value: 1 }),
      ).toThrow(PricingEngineError);
      expect(() => validateAction({ kind: 'DROP TABLE' })).toThrow(
        PricingEngineError,
      );
      expect(() => validateAction(null)).toThrow(PricingEngineError);
    });

    it('refuses a dynamic rule with no movement limit (an unbounded price)', () => {
      const base = {
        kind: 'DYNAMIC',
        signal: 'daysToDeparture',
        bands: [{ upTo: 7, adjustPercent: 5 }],
      };
      expect(() => validateAction({ ...base, limits: {} })).toThrow(
        /maxMovementPercent/,
      );
      expect(() => validateAction({ ...base })).toThrow(/limits/);
      expect(() =>
        validateAction({ ...base, limits: { maxMovementPercent: 150 } }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({
          ...base,
          limits: { maxMovementPercent: 10, minPrice: 500, maxPrice: 100 },
        }),
      ).toThrow(/minPrice/);
      expect(() =>
        validateAction({
          ...base,
          bands: [],
          limits: { maxMovementPercent: 10 },
        }),
      ).toThrow(PricingEngineError);
      expect(() =>
        validateAction({
          ...base,
          bands: [{ upTo: 7, adjustPercent: 500 }],
          limits: { maxMovementPercent: 10 },
        }),
      ).toThrow(PricingEngineError);
      expect(
        validateAction({
          ...base,
          limits: { maxMovementPercent: 10, maxMarkupPercent: 25 },
        }),
      ).toMatchObject({ kind: 'DYNAMIC' });
    });
  });

  describe('tier and stored rows', () => {
    it('only the defined tiers are valid', () => {
      expect(validateTier('CONTRACT')).toBe('CONTRACT');
      expect(() => validateTier('GOD_MODE')).toThrow(PricingEngineError);
    });

    it('converts a stored row into an engine rule carrying its version', () => {
      const rule = toEngineRule({
        id: 'r1',
        name: 'LOS-ABV markup',
        tier: 'PRODUCT',
        priority: 3,
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
        currentVersion: 4,
        conditions: { origin: 'LOS', destination: 'ABV' },
        action: { kind: 'MARKUP', mode: 'PERCENT', value: 6 },
      });
      expect(rule).toMatchObject({
        id: 'r1',
        version: 4,
        tier: 'PRODUCT',
        conditions: { origin: 'LOS', destination: 'ABV' },
      });
    });

    it('a corrupt stored row throws instead of being priced with', () => {
      expect(() =>
        toEngineRule({
          id: 'bad',
          name: 'x',
          tier: 'PRODUCT',
          priority: 0,
          isActive: true,
          effectiveFrom: null,
          effectiveTo: null,
          currentVersion: 1,
          conditions: {},
          action: { kind: 'MARKUP', mode: 'PERCENT', value: -3 },
        }),
      ).toThrow(PricingEngineError);
    });
  });
});
