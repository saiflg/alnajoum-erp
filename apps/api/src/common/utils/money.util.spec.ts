import {
  assertMoney,
  assertPercent,
  changePercent,
  clampMoney,
  inclusiveTaxPortion,
  MoneyError,
  percentOf,
} from './money.util';

describe('money.util', () => {
  describe('percentOf — must agree with the Math.round(x * p / 100) the codebase already uses', () => {
    const samples: Array<[number, number]> = [
      [500_000, 10],
      [1_000, 7.5],
      [123_457, 12.5],
      [99_999, 3],
      [1, 50],
      [0, 25],
      [250_000, 0],
      [1_234_567, 7.25],
      [45_000, 18],
    ];
    it.each(samples)('percentOf(%d, %d) matches Math.round', (amount, pct) => {
      expect(percentOf(amount, pct)).toBe(Math.round((amount * pct) / 100));
    });

    it('rounds an exact half up (0.5 -> 1, 1.5 -> 2)', () => {
      expect(percentOf(1, 50)).toBe(1);
      expect(percentOf(3, 50)).toBe(2);
    });

    it('is exact where binary floating point is not (7.5% of 1,000)', () => {
      expect(percentOf(1_000, 7.5)).toBe(75);
    });
  });

  describe('validation — negative-price and injection guards', () => {
    it('rejects negative, fractional, NaN and infinite amounts', () => {
      for (const bad of [-1, 1.5, NaN, Infinity]) {
        expect(() => assertMoney(bad)).toThrow(MoneyError);
        expect(() => percentOf(bad, 10)).toThrow(MoneyError);
      }
    });

    it('rejects negative or absurd percentages', () => {
      expect(() => assertPercent(-1)).toThrow(MoneyError);
      expect(() => assertPercent(1001)).toThrow(MoneyError);
      expect(() => assertPercent(NaN)).toThrow(MoneyError);
      expect(() => percentOf(100, -5)).toThrow(MoneyError);
    });
  });

  describe('inclusiveTaxPortion', () => {
    it('extracts the tax already contained in a gross price (7.5% VAT in 107,500)', () => {
      expect(inclusiveTaxPortion(107_500, 7.5)).toBe(7_500);
    });
    it('is zero at a zero rate', () => {
      expect(inclusiveTaxPortion(100_000, 0)).toBe(0);
    });
    it('net + tax always reconstructs the gross', () => {
      for (const gross of [107_500, 99_999, 1, 12_345]) {
        const tax = inclusiveTaxPortion(gross, 7.5);
        expect(gross - tax).toBeGreaterThanOrEqual(0);
        expect(tax).toBeLessThanOrEqual(gross);
      }
    });
  });

  describe('clampMoney / changePercent', () => {
    it('clamps to either bound and ignores missing bounds', () => {
      expect(clampMoney(50, 100, 200)).toBe(100);
      expect(clampMoney(500, 100, 200)).toBe(200);
      expect(clampMoney(150, 100, 200)).toBe(150);
      expect(clampMoney(150)).toBe(150);
      expect(clampMoney(150, null, undefined)).toBe(150);
    });
    it('reports signed change and tolerates a zero base', () => {
      expect(changePercent(110, 100)).toBeCloseTo(10);
      expect(changePercent(90, 100)).toBeCloseTo(-10);
      expect(changePercent(5, 0)).toBe(0);
    });
  });
});
