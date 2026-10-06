import { PricingBreakdown } from './pricing.types';

/**
 * What a customer (web or mobile) may be shown. Deliberately omits supplier
 * cost, markup, margin, the rules that applied and the trace: those are
 * internal commercial figures. "Base price" is everything before fees, tax and
 * discount, so the customer sees how the total is made up without learning
 * what the supplier charges the agency.
 */
export interface CustomerPriceView {
  currency: string;
  basePrice: number;
  fees: Array<{ type: string; amount: number }>;
  discount: number;
  taxes: Array<{ name: string; amount: number; inclusive: boolean }>;
  total: number;
}

export function toCustomerView(b: PricingBreakdown): CustomerPriceView {
  return {
    currency: b.currency,
    basePrice: b.supplierCost + b.markup + b.dynamicAdjustment,
    fees: b.fees.map((f) => ({ type: f.feeType, amount: f.amount })),
    discount: b.discount,
    taxes: b.taxes.map((t) => ({
      name: t.name,
      amount: t.amount,
      inclusive: t.inclusive,
    })),
    total: b.customerPrice,
  };
}
