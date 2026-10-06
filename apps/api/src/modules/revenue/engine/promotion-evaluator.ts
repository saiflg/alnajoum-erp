import { percentOf } from '../../../common/utils/money.util';
import { DiscountInput } from './pricing.types';

export interface PromotionSnapshot {
  id: string;
  name: string;
  code: string | null;
  mode: 'FIXED' | 'PERCENT';
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  products: string[];
  channels: string[];
  minBookingAmount: number | null;
  maxDiscountAmount: number | null;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  budget: number | null;
  usedCount: number;
  budgetUsed: number;
}

export interface PromotionContext {
  product: string;
  channel?: string;
  /** The pre-discount amount the promotion would apply to (the engine's subtotal). */
  bookingAmount: number;
  /** The code the customer presented, if any. */
  presentedCode?: string | null;
  /** How many times THIS customer has already redeemed THIS promotion. */
  customerUsageCount: number;
  now: Date;
}

export type PromotionRejection =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'PRODUCT_NOT_ELIGIBLE'
  | 'CHANNEL_NOT_ELIGIBLE'
  | 'BELOW_MINIMUM_BOOKING'
  | 'CODE_REQUIRED'
  | 'CODE_MISMATCH'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'BUDGET_EXHAUSTED';

export type PromotionEvaluation =
  | {
      eligible: true;
      discountAmount: number;
      discount: DiscountInput;
      capped: boolean;
    }
  | { eligible: false; reason: PromotionRejection };

/**
 * Decides whether a promotion applies and how much it takes off. Pure: every
 * limit it checks is data it is handed, and PromotionsService.redeem runs it
 * again inside a row-locked transaction, so the decision a customer is shown
 * and the decision that is actually enforced come from the same function.
 */
export function evaluatePromotion(
  p: PromotionSnapshot,
  c: PromotionContext,
): PromotionEvaluation {
  const no = (reason: PromotionRejection): PromotionEvaluation => ({
    eligible: false,
    reason,
  });

  if (!p.isActive) return no('INACTIVE');
  if (c.now < p.startsAt) return no('NOT_STARTED');
  if (c.now > p.endsAt) return no('EXPIRED');
  if (p.products.length > 0 && !p.products.includes(c.product))
    return no('PRODUCT_NOT_ELIGIBLE');
  if (p.channels.length > 0 && (!c.channel || !p.channels.includes(c.channel)))
    return no('CHANNEL_NOT_ELIGIBLE');

  if (p.code) {
    if (!c.presentedCode) return no('CODE_REQUIRED');
    if (c.presentedCode.trim().toUpperCase() !== p.code.toUpperCase())
      return no('CODE_MISMATCH');
  }

  if (p.minBookingAmount !== null && c.bookingAmount < p.minBookingAmount)
    return no('BELOW_MINIMUM_BOOKING');
  if (p.totalUsageLimit !== null && p.usedCount >= p.totalUsageLimit)
    return no('USAGE_LIMIT_REACHED');
  if (p.perCustomerLimit !== null && c.customerUsageCount >= p.perCustomerLimit)
    return no('CUSTOMER_LIMIT_REACHED');

  let amount =
    p.mode === 'FIXED' ? p.value : percentOf(c.bookingAmount, p.value);
  let capped = false;
  if (p.maxDiscountAmount !== null && amount > p.maxDiscountAmount) {
    amount = p.maxDiscountAmount;
    capped = true;
  }
  if (amount > c.bookingAmount) {
    amount = c.bookingAmount; // never discount more than the amount it applies to
    capped = true;
  }
  if (p.budget !== null) {
    const remaining = p.budget - p.budgetUsed;
    if (remaining <= 0) return no('BUDGET_EXHAUSTED');
    if (amount > remaining) {
      amount = remaining;
      capped = true;
    }
  }
  if (amount <= 0) return no('BUDGET_EXHAUSTED');

  return {
    eligible: true,
    discountAmount: amount,
    capped,
    // Always FIXED here: the caps above are already folded into the final amount.
    discount: {
      source: `PROMOTION:${p.code ?? p.id}`,
      mode: 'FIXED',
      value: amount,
    },
  };
}
