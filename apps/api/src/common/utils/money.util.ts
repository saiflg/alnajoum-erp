/**
 * Shared money helpers. Every money column in this system is an Int in whole
 * currency units (no minor units), and every existing percentage calculation
 * (flight markup, refund fees, incentives, FX conversion) rounds half-up with
 * `Math.round(amount * percent / 100)`. This is the one place that rule
 * lives for new code, so it can't drift into a thirteenth copy.
 *
 * Percentages are converted to integer basis points first and the division is
 * done in integer arithmetic, which avoids floating-point artefacts such as
 * 0.1 + 0.2 !== 0.3 while still matching `Math.round` for every ordinary
 * input (non-negative amounts, percentages with up to two decimals).
 */

export class MoneyError extends Error {}

/** Throws unless `value` is a finite, non-negative whole number. */
export function assertMoney(value: number, label = 'amount'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new MoneyError(
      `${label} must be a non-negative whole number, got ${value}`,
    );
  }
  return value;
}

/** Throws unless `percent` is finite and within [0, max]. */
export function assertPercent(
  percent: number,
  label = 'percent',
  max = 1000,
): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > max) {
    throw new MoneyError(
      `${label} must be between 0 and ${max}, got ${percent}`,
    );
  }
  return percent;
}

/**
 * `percent`% of `amount`, rounded half-up to a whole unit.
 * percentOf(1_000, 7.5) === 75; percentOf(1, 50) === 1 (0.5 rounds up).
 */
export function percentOf(amount: number, percent: number): number {
  assertMoney(amount, 'amount');
  assertPercent(percent);
  const basisPoints = Math.round(percent * 100);
  return Math.floor((2 * amount * basisPoints + 10_000) / 20_000);
}

/** The portion of a tax-INCLUSIVE gross amount that is tax, at `ratePercent`. */
export function inclusiveTaxPortion(
  gross: number,
  ratePercent: number,
): number {
  assertMoney(gross, 'gross');
  assertPercent(ratePercent, 'ratePercent');
  const basisPoints = Math.round(ratePercent * 100);
  // tax = gross * r / (1 + r), r = bps / 10_000, i.e. gross * bps / divisor,
  // rounded half-up in integer arithmetic.
  const divisor = 10_000 + basisPoints;
  return Math.floor((2 * gross * basisPoints + divisor) / (2 * divisor));
}

/** Clamp to [min, max]; either bound may be omitted. */
export function clampMoney(
  value: number,
  min?: number | null,
  max?: number | null,
): number {
  let out = value;
  if (min != null && out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

/** Signed difference as a percentage of `base`, e.g. (110, 100) -> 10. Returns 0 for a zero base. */
export function changePercent(next: number, base: number): number {
  if (base === 0) return 0;
  return ((next - base) / base) * 100;
}
