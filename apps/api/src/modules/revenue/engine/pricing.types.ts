/**
 * Phase 19 — revenue-management pricing engine: shared types.
 *
 * Money is an Int in whole currency units, exactly like every money column in
 * the ERP (see common/utils/money.util.ts). The engine is PURE: it takes the
 * rules and context it is handed and returns a breakdown plus a trace. It
 * never reads the database, the clock, or any global, so the same inputs
 * always produce the same price (deterministic, reproducible for disputes).
 */

/**
 * Precedence tiers, highest authority first. When two rules compete for the
 * same slot (the single markup, a given fee type, the discount), the rule in
 * the EARLIER tier wins; ties inside a tier fall to `priority` (higher wins),
 * then to specificity (more conditions), then to the newer `version`, then to
 * `id` — so there is never an ambiguous outcome.
 *
 *   CONTRACT  a negotiated corporate / agent / supplier agreement
 *   PRODUCT   the product's own commercial rule (route, airline, hotel, ...)
 *   SEGMENT   an explicit customer-segment rule (VIP, group, ...)
 *   CAMPAIGN  a time-boxed campaign or promotion rule
 *   CHANNEL   a channel default (web, mobile, partner)
 *
 * This order is a business decision, documented in docs/revenue-management.md;
 * it is explicit data here (TIER_ORDER), not an accident of evaluation order.
 */
export type PricingTier =
  'CONTRACT' | 'PRODUCT' | 'SEGMENT' | 'CAMPAIGN' | 'CHANNEL';

export const TIER_ORDER: readonly PricingTier[] = [
  'CONTRACT',
  'PRODUCT',
  'SEGMENT',
  'CAMPAIGN',
  'CHANNEL',
];

export type AmountMode = 'FIXED' | 'PERCENT';

export interface RuleConditions {
  product?: string; // FLIGHT | HOTEL | VISA | HAJJ | UMRAH | PACKAGE | VEHICLE | ...
  supplierId?: string;
  airlineCode?: string;
  origin?: string;
  destination?: string;
  cabinClass?: string;
  roomType?: string;
  channel?: string; // WEB | MOBILE | AGENT | CORPORATE | PARTNER | ...
  customerSegment?: string; // explicit system classification only
  corporateAccountId?: string;
  agentId?: string;
  branchId?: string;
  currency?: string;
  paymentMethod?: string;
  minPassengers?: number;
  maxPassengers?: number;
  minAdvanceDays?: number; // days between booking date and travel date
  maxAdvanceDays?: number;
}

export interface MarkupAction {
  kind: 'MARKUP';
  mode: AmountMode;
  value: number;
}

export interface FeeAction {
  kind: 'FEE';
  /** BOOKING | SERVICE | PAYMENT | DOCUMENT | ... — one winning rule per feeType. */
  feeType: string;
  mode: AmountMode;
  value: number;
}

export interface DiscountAction {
  kind: 'DISCOUNT';
  mode: AmountMode;
  value: number;
  /** A stackable discount adds to other stackable ones; a non-stackable one competes for the single slot. */
  stackable?: boolean;
}

export interface TaxAction {
  kind: 'TAX';
  name: string;
  ratePercent: number;
  /** true: the displayed price already contains this tax. false: it is added on top. */
  inclusive: boolean;
}

export interface DynamicBand {
  /** The band applies while the signal value is <= upTo (bands are matched in ascending order). */
  upTo: number;
  /** Signed percentage adjustment to the pre-discount subtotal, e.g. +8 or -5. */
  adjustPercent: number;
}

/**
 * Controlled dynamic pricing: a configured lookup from a measured signal to a
 * percentage adjustment, always clamped by explicit limits. Never AI-chosen.
 */
export interface DynamicAction {
  kind: 'DYNAMIC';
  signal: 'daysToDeparture' | 'inventoryRemainingPercent';
  bands: DynamicBand[];
  limits: {
    /** Largest allowed movement versus the pre-adjustment subtotal, in percent. */
    maxMovementPercent: number;
    minPrice?: number;
    maxPrice?: number;
    /** Largest allowed total markup as a percentage of supplier cost. */
    maxMarkupPercent?: number;
  };
}

export type RuleAction =
  MarkupAction | FeeAction | DiscountAction | TaxAction | DynamicAction;

export interface PricingRuleInput {
  id: string;
  name: string;
  version: number;
  tier: PricingTier;
  priority: number;
  isActive: boolean;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  conditions: RuleConditions;
  action: RuleAction;
}

export interface MarginPolicy {
  minAbsolute?: number;
  minPercent?: number;
  /** Largest total discount allowed as a percentage of the pre-discount subtotal. */
  maxDiscountPercent?: number;
}

export interface PricingContext {
  product: string;
  /** The supplier's price for the whole booking (already × nights/passengers/rooms). */
  supplierCost: number;
  currency: string;
  /** When true the supplier price already contains tax, so TAX rules are skipped (never double-taxed). */
  taxIncludedInSupplierCost?: boolean;
  supplierId?: string;
  airlineCode?: string;
  origin?: string;
  destination?: string;
  cabinClass?: string;
  roomType?: string;
  channel?: string;
  customerSegment?: string;
  corporateAccountId?: string;
  agentId?: string;
  branchId?: string;
  paymentMethod?: string;
  passengers?: number;
  /** Days from the booking date to the travel/check-in date. */
  advanceDays?: number;
  /** Signals for DYNAMIC rules. */
  daysToDeparture?: number;
  inventoryRemainingPercent?: number;
}

/** A discount handed in by the caller (a validated promotion/coupon, a staff discount) rather than a stored rule. */
export interface DiscountInput {
  source: string; // e.g. "PROMOTION:SUMMER24", "COUPON:ABC123", "STAFF"
  mode: AmountMode;
  value: number;
}

export interface MarginOverride {
  approvedBy: string;
  reason: string;
}

export interface PricingInput {
  context: PricingContext;
  rules: PricingRuleInput[];
  marginPolicy?: MarginPolicy;
  extraDiscounts?: DiscountInput[];
  override?: MarginOverride | null;
  /** Injected, never read from the clock inside the engine. */
  now: Date;
}

export type TraceStatus =
  'APPLIED' | 'SUPERSEDED' | 'SKIPPED' | 'CLAMPED' | 'NOT_MATCHED';

export interface TraceEntry {
  step:
    | 'SUPPLIER_COST'
    | 'MARKUP'
    | 'FEE'
    | 'DYNAMIC'
    | 'DISCOUNT'
    | 'TAX'
    | 'MARGIN'
    | 'OVERRIDE'
    | 'RESULT';
  status: TraceStatus;
  description: string;
  ruleId?: string;
  ruleVersion?: number;
  ruleName?: string;
  tier?: PricingTier;
  /** The figure the calculation started from. */
  inputAmount?: number;
  /** The amount this step added (positive) or removed (negative). */
  amount: number;
  /** Price running total after this step. */
  runningTotal?: number;
  currency: string;
  /** Why it lost / was skipped / was clamped. */
  note?: string;
}

export type PricingStatus = 'OK' | 'REQUIRES_OVERRIDE';

export interface FeeLine {
  feeType: string;
  amount: number;
  ruleId: string;
}

export interface TaxLine {
  name: string;
  amount: number;
  inclusive: boolean;
  ruleId: string;
}

export interface PricingBreakdown {
  currency: string;
  supplierCost: number;
  markup: number;
  fees: FeeLine[];
  totalFees: number;
  dynamicAdjustment: number;
  /** supplierCost + markup + fees + dynamicAdjustment, before discount and tax. */
  subtotal: number;
  discount: number;
  /** subtotal - discount: the amount the agency actually earns on, before any tax. */
  netBeforeTax: number;
  taxes: TaxLine[];
  /** Tax added on top of netBeforeTax (exclusive taxes only). */
  taxAdded: number;
  /** Tax already contained in the price (inclusive taxes), reported for transparency. */
  taxIncluded: number;
  customerPrice: number;
  /** Revenue excluding any tax: customerPrice - all tax. */
  revenueExTax: number;
  /** revenueExTax - supplierCost. With no tax rules this equals customerPrice - supplierCost, the ERP's existing margin. */
  margin: number;
  marginPercent: number;
}

export interface PricingResult {
  status: PricingStatus;
  breakdown: PricingBreakdown;
  trace: TraceEntry[];
  /** Populated when status is REQUIRES_OVERRIDE. */
  violations: string[];
  engineVersion: string;
  calculatedAt: string;
  /** The exact rule ids+versions that shaped this price — stored on the booking snapshot. */
  appliedRules: Array<{ id: string; version: number }>;
}

export const PRICING_ENGINE_VERSION = '1.0.0';
