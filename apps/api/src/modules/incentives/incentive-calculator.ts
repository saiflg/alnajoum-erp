import { IncentivePolicyType } from '@prisma/client';

interface PolicyConfig {
  percent?: number;
  amount?: number;
  staffPercent?: number;
  branchPercent?: number;
}

/**
 * Pure calculation, shared by every module that pays a staff incentive off
 * a margin-based IncentivePolicy (visa applications, flight bookings, ...)
 * — the spec's own instruction for Phase 4 ("do not duplicate incentive
 * logic inside the flight module") applies just as much to any future
 * module, so this lives here once rather than being copied per module.
 * Originally written for Phase 3 visa incentives (see
 * visa-incentives.service.ts, which re-exports this for backward
 * compatibility) and moved here unchanged when Phase 4 needed the same
 * math for flight bookings.
 *
 * Deliberately conservative when a policy is missing or its config is
 * incomplete: returns 0 rather than guessing, per the spec's "IMPORTANT
 * FINANCIAL CONTROL — do not automatically treat every difference between
 * selling price and cost as staff profit" requirement. A margin of 0 or
 * less also always yields 0 — there's no such thing as a negative
 * incentive.
 */
export function calculateStaffIncentiveAmount(
  margin: number,
  policy: { type: IncentivePolicyType; config: unknown } | null,
): number {
  if (margin <= 0 || !policy) {
    return 0;
  }
  const config = (policy.config ?? {}) as PolicyConfig;

  switch (policy.type) {
    case IncentivePolicyType.FULL_MARGIN:
      return margin;
    case IncentivePolicyType.PERCENT_OF_MARGIN:
    case IncentivePolicyType.CUSTOM: {
      if (typeof config.amount === 'number') {
        return Math.min(config.amount, margin);
      }
      if (typeof config.percent === 'number') {
        return Math.round((margin * config.percent) / 100);
      }
      return 0;
    }
    case IncentivePolicyType.FIXED_AMOUNT:
      return typeof config.amount === 'number'
        ? Math.min(config.amount, margin)
        : 0;
    case IncentivePolicyType.STAFF_COMPANY_SPLIT:
      return typeof config.staffPercent === 'number'
        ? Math.round((margin * config.staffPercent) / 100)
        : 0;
    case IncentivePolicyType.STAFF_BRANCH_COMPANY_SPLIT:
      return typeof config.staffPercent === 'number'
        ? Math.round((margin * config.staffPercent) / 100)
        : 0;
    default:
      return 0;
  }
}
