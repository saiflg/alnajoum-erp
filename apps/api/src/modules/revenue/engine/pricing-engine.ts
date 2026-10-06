import {
  assertMoney,
  assertPercent,
  clampMoney,
  inclusiveTaxPortion,
  percentOf,
} from '../../../common/utils/money.util';
import {
  DiscountAction,
  DynamicAction,
  FeeAction,
  FeeLine,
  MarkupAction,
  PRICING_ENGINE_VERSION,
  PricingBreakdown,
  PricingContext,
  PricingInput,
  PricingResult,
  PricingRuleInput,
  RuleConditions,
  TaxAction,
  TaxLine,
  TIER_ORDER,
  TraceEntry,
} from './pricing.types';

export class PricingEngineError extends Error {}

const CONDITION_KEYS: Array<keyof RuleConditions> = [
  'product',
  'supplierId',
  'airlineCode',
  'origin',
  'destination',
  'cabinClass',
  'roomType',
  'channel',
  'customerSegment',
  'corporateAccountId',
  'agentId',
  'branchId',
  'currency',
  'paymentMethod',
  'minPassengers',
  'maxPassengers',
  'minAdvanceDays',
  'maxAdvanceDays',
];

/** How many conditions a rule sets — the tie-breaker "more specific wins". */
export function specificity(rule: PricingRuleInput): number {
  return CONDITION_KEYS.filter(
    (k) => rule.conditions[k] !== undefined && rule.conditions[k] !== null,
  ).length;
}

export function ruleIsInEffect(rule: PricingRuleInput, now: Date): boolean {
  if (!rule.isActive) return false;
  if (rule.effectiveFrom && rule.effectiveFrom > now) return false;
  if (rule.effectiveTo && rule.effectiveTo < now) return false;
  return true;
}

/** Every condition the rule sets must hold; an unset condition matches anything. */
export function conditionsMatch(
  c: RuleConditions,
  ctx: PricingContext,
): boolean {
  const eq = <T>(want: T | undefined, have: T | undefined) =>
    want === undefined || want === have;
  if (!eq(c.product, ctx.product)) return false;
  if (!eq(c.supplierId, ctx.supplierId)) return false;
  if (!eq(c.airlineCode, ctx.airlineCode)) return false;
  if (!eq(c.origin, ctx.origin)) return false;
  if (!eq(c.destination, ctx.destination)) return false;
  if (!eq(c.cabinClass, ctx.cabinClass)) return false;
  if (!eq(c.roomType, ctx.roomType)) return false;
  if (!eq(c.channel, ctx.channel)) return false;
  if (!eq(c.customerSegment, ctx.customerSegment)) return false;
  if (!eq(c.corporateAccountId, ctx.corporateAccountId)) return false;
  if (!eq(c.agentId, ctx.agentId)) return false;
  if (!eq(c.branchId, ctx.branchId)) return false;
  if (!eq(c.currency, ctx.currency)) return false;
  if (!eq(c.paymentMethod, ctx.paymentMethod)) return false;

  const pax = ctx.passengers;
  if (
    c.minPassengers !== undefined &&
    (pax === undefined || pax < c.minPassengers)
  )
    return false;
  if (
    c.maxPassengers !== undefined &&
    (pax === undefined || pax > c.maxPassengers)
  )
    return false;
  const adv = ctx.advanceDays;
  if (
    c.minAdvanceDays !== undefined &&
    (adv === undefined || adv < c.minAdvanceDays)
  )
    return false;
  if (
    c.maxAdvanceDays !== undefined &&
    (adv === undefined || adv > c.maxAdvanceDays)
  )
    return false;
  return true;
}

/** Deterministic ordering: tier, then priority, then specificity, then newer version, then id. */
export function compareRules(a: PricingRuleInput, b: PricingRuleInput): number {
  return (
    TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
    b.priority - a.priority ||
    specificity(b) - specificity(a) ||
    b.version - a.version ||
    a.id.localeCompare(b.id)
  );
}

function pickWinner(rules: PricingRuleInput[]): {
  winner: PricingRuleInput | null;
  losers: PricingRuleInput[];
} {
  if (rules.length === 0) return { winner: null, losers: [] };
  const sorted = [...rules].sort(compareRules);
  return { winner: sorted[0], losers: sorted.slice(1) };
}

function describeWin(w: PricingRuleInput): string {
  return `${w.name} (tier ${w.tier}, priority ${w.priority}, v${w.version})`;
}

function amountFor(
  action: { mode: 'FIXED' | 'PERCENT'; value: number },
  base: number,
  label: string,
): number {
  if (action.mode === 'FIXED')
    return assertMoney(action.value, `${label} value`);
  assertPercent(action.value, `${label} value`);
  return percentOf(base, action.value);
}

function ofKind<A extends PricingRuleInput['action']['kind']>(
  rules: PricingRuleInput[],
  kind: A,
): Array<
  PricingRuleInput & {
    action: Extract<PricingRuleInput['action'], { kind: A }>;
  }
> {
  return rules.filter((r) => r.action.kind === kind) as Array<
    PricingRuleInput & {
      action: Extract<PricingRuleInput['action'], { kind: A }>;
    }
  >;
}

/**
 * Computes the customer price and its full explanation.
 *
 * Order of calculation (each step's output feeds the next):
 *   supplier cost
 *   + markup            one winning rule (tier > priority > specificity > version)
 *   + fees              one winning rule per fee type
 *   +/- dynamic         one winning rule, clamped by its own limits
 *   = subtotal
 *   - discount          stored rules + caller-supplied promotions, capped by policy
 *   = net before tax    <- what the agency earns on
 *   + exclusive tax     inclusive tax is reported, never added
 *   = customer price
 *
 * margin = (customer price - all tax) - supplier cost. With no tax rules this
 * is exactly customerPrice - supplierCost, the margin the ERP already reports.
 */
export function calculatePrice(input: PricingInput): PricingResult {
  const { context: ctx, now } = input;
  assertMoney(ctx.supplierCost, 'supplierCost');
  if (!ctx.currency) throw new PricingEngineError('currency is required');

  const currency = ctx.currency;
  const trace: TraceEntry[] = [];
  const push = (e: Omit<TraceEntry, 'currency'>) =>
    trace.push({ ...e, currency });

  const eligible = input.rules.filter(
    (r) => ruleIsInEffect(r, now) && conditionsMatch(r.conditions, ctx),
  );

  push({
    step: 'SUPPLIER_COST',
    status: 'APPLIED',
    description: 'Supplier cost',
    amount: ctx.supplierCost,
    runningTotal: ctx.supplierCost,
  });

  const recordLosers = (
    step: TraceEntry['step'],
    winner: PricingRuleInput,
    losers: PricingRuleInput[],
  ) => {
    for (const l of losers) {
      push({
        step,
        status: 'SUPERSEDED',
        description: `${l.name} did not apply`,
        ruleId: l.id,
        ruleVersion: l.version,
        ruleName: l.name,
        tier: l.tier,
        amount: 0,
        note: `Lost to ${describeWin(winner)}`,
      });
    }
  };

  // ---- Markup
  let markup = 0;
  {
    const { winner, losers } = pickWinner(ofKind(eligible, 'MARKUP'));
    if (winner) {
      const a = winner.action as MarkupAction;
      markup = amountFor(a, ctx.supplierCost, `markup rule ${winner.id}`);
      push({
        step: 'MARKUP',
        status: 'APPLIED',
        description: `Markup ${a.mode === 'PERCENT' ? `${a.value}%` : 'fixed'}`,
        ruleId: winner.id,
        ruleVersion: winner.version,
        ruleName: winner.name,
        tier: winner.tier,
        inputAmount: ctx.supplierCost,
        amount: markup,
        runningTotal: ctx.supplierCost + markup,
      });
      recordLosers('MARKUP', winner, losers);
    } else {
      push({
        step: 'MARKUP',
        status: 'SKIPPED',
        description: 'No markup rule matched',
        amount: 0,
        runningTotal: ctx.supplierCost,
        note: 'Zero markup applied',
      });
    }
  }

  // ---- Fees (one winner per fee type)
  const fees: FeeLine[] = [];
  {
    const feeRules = ofKind(eligible, 'FEE');
    const byType = new Map<string, typeof feeRules>();
    for (const r of feeRules) {
      const t = r.action.feeType;
      byType.set(t, [...(byType.get(t) ?? []), r]);
    }
    for (const type of [...byType.keys()].sort()) {
      const { winner, losers } = pickWinner(byType.get(type)!);
      if (!winner) continue;
      const a = winner.action as FeeAction;
      const base = ctx.supplierCost + markup;
      const amount = amountFor(a, base, `fee rule ${winner.id}`);
      fees.push({ feeType: type, amount, ruleId: winner.id });
      push({
        step: 'FEE',
        status: 'APPLIED',
        description: `${type} fee`,
        ruleId: winner.id,
        ruleVersion: winner.version,
        ruleName: winner.name,
        tier: winner.tier,
        inputAmount: base,
        amount,
        runningTotal: base + fees.reduce((s, f) => s + f.amount, 0),
      });
      recordLosers('FEE', winner, losers);
    }
  }
  const totalFees = fees.reduce((s, f) => s + f.amount, 0);

  // ---- Dynamic adjustment (always clamped)
  let dynamicAdjustment = 0;
  {
    const { winner, losers } = pickWinner(ofKind(eligible, 'DYNAMIC'));
    const preDynamic = ctx.supplierCost + markup + totalFees;
    if (winner) {
      const a = winner.action as DynamicAction;
      const signal = ctx[a.signal];
      if (signal === undefined || signal === null) {
        push({
          step: 'DYNAMIC',
          status: 'SKIPPED',
          description: `Dynamic rule ${winner.name} needs ${a.signal}`,
          ruleId: winner.id,
          ruleVersion: winner.version,
          ruleName: winner.name,
          tier: winner.tier,
          amount: 0,
          note: 'Signal not provided; no adjustment',
        });
      } else {
        const bands = [...a.bands].sort((x, y) => x.upTo - y.upTo);
        const band = bands.find((b) => signal <= b.upTo);
        if (!band) {
          push({
            step: 'DYNAMIC',
            status: 'NOT_MATCHED',
            description: `${a.signal}=${signal} is outside every band`,
            ruleId: winner.id,
            ruleVersion: winner.version,
            ruleName: winner.name,
            tier: winner.tier,
            amount: 0,
          });
        } else {
          assertPercent(Math.abs(band.adjustPercent), 'dynamic adjustPercent');
          assertPercent(a.limits.maxMovementPercent, 'maxMovementPercent');
          const direction = band.adjustPercent < 0 ? -1 : 1;
          let delta =
            direction * percentOf(preDynamic, Math.abs(band.adjustPercent));
          const notes: string[] = [];

          const maxMove = percentOf(preDynamic, a.limits.maxMovementPercent);
          if (Math.abs(delta) > maxMove) {
            delta = direction * maxMove;
            notes.push(`movement limited to ${a.limits.maxMovementPercent}%`);
          }
          if (a.limits.maxMarkupPercent !== undefined && delta > 0) {
            const markupCap = percentOf(
              ctx.supplierCost,
              a.limits.maxMarkupPercent,
            );
            const room = Math.max(0, markupCap - markup);
            if (delta > room) {
              delta = room;
              notes.push(
                `total markup limited to ${a.limits.maxMarkupPercent}% of cost`,
              );
            }
          }
          const clamped = clampMoney(
            preDynamic + delta,
            a.limits.minPrice,
            a.limits.maxPrice,
          );
          if (clamped !== preDynamic + delta) {
            delta = clamped - preDynamic;
            notes.push('price floor/ceiling applied');
          }
          dynamicAdjustment = delta;
          push({
            step: 'DYNAMIC',
            status: notes.length ? 'CLAMPED' : 'APPLIED',
            description: `Dynamic ${a.signal}=${signal} → ${band.adjustPercent >= 0 ? '+' : ''}${band.adjustPercent}%`,
            ruleId: winner.id,
            ruleVersion: winner.version,
            ruleName: winner.name,
            tier: winner.tier,
            inputAmount: preDynamic,
            amount: delta,
            runningTotal: preDynamic + delta,
            note: notes.join('; ') || undefined,
          });
        }
      }
      recordLosers('DYNAMIC', winner, losers);
    }
  }

  const subtotal = Math.max(
    0,
    ctx.supplierCost + markup + totalFees + dynamicAdjustment,
  );

  // ---- Discount
  let discount = 0;
  {
    const discountRules = ofKind(eligible, 'DISCOUNT');
    const stackable = discountRules.filter((r) => r.action.stackable);
    const competing = discountRules.filter((r) => !r.action.stackable);
    const { winner, losers } = pickWinner(competing);

    const lines: Array<{
      rule?: PricingRuleInput;
      source: string;
      amount: number;
    }> = [];
    if (winner) {
      lines.push({
        rule: winner,
        source: winner.name,
        amount: amountFor(
          winner.action as DiscountAction,
          subtotal,
          `discount rule ${winner.id}`,
        ),
      });
    }
    for (const r of stackable) {
      lines.push({
        rule: r,
        source: r.name,
        amount: amountFor(r.action, subtotal, `discount rule ${r.id}`),
      });
    }
    for (const e of input.extraDiscounts ?? []) {
      lines.push({
        source: e.source,
        amount: amountFor(e, subtotal, `discount ${e.source}`),
      });
    }

    let running = subtotal;
    for (const l of lines) {
      running -= l.amount;
      push({
        step: 'DISCOUNT',
        status: 'APPLIED',
        description: `Discount: ${l.source}`,
        ruleId: l.rule?.id,
        ruleVersion: l.rule?.version,
        ruleName: l.rule?.name,
        tier: l.rule?.tier,
        inputAmount: subtotal,
        amount: -l.amount,
        runningTotal: running,
      });
    }
    if (winner) recordLosers('DISCOUNT', winner, losers);

    discount = lines.reduce((s, l) => s + l.amount, 0);

    const maxPct = input.marginPolicy?.maxDiscountPercent;
    if (maxPct !== undefined) {
      assertPercent(maxPct, 'maxDiscountPercent');
      const cap = percentOf(subtotal, maxPct);
      if (discount > cap) {
        push({
          step: 'DISCOUNT',
          status: 'CLAMPED',
          description: `Total discount capped at ${maxPct}% of the subtotal`,
          amount: cap - discount,
          runningTotal: subtotal - cap,
          note: `Requested ${discount}, allowed ${cap}`,
        });
        discount = cap;
      }
    }
    if (discount > subtotal) {
      push({
        step: 'DISCOUNT',
        status: 'CLAMPED',
        description:
          'Discount can never exceed the subtotal (no negative prices)',
        amount: subtotal - discount,
        runningTotal: 0,
      });
      discount = subtotal;
    }
  }

  const netBeforeTax = subtotal - discount;

  // ---- Tax
  const taxes: TaxLine[] = [];
  {
    const taxRules = ofKind(eligible, 'TAX');
    if (ctx.taxIncludedInSupplierCost) {
      for (const r of taxRules) {
        push({
          step: 'TAX',
          status: 'SKIPPED',
          description: `${r.action.name} not added`,
          ruleId: r.id,
          ruleVersion: r.version,
          ruleName: r.name,
          tier: r.tier,
          amount: 0,
          note: 'Supplier price already includes tax',
        });
      }
    } else {
      const byName = new Map<string, typeof taxRules>();
      for (const r of taxRules) {
        const n = r.action.name;
        byName.set(n, [...(byName.get(n) ?? []), r]);
      }
      for (const name of [...byName.keys()].sort()) {
        const { winner, losers } = pickWinner(byName.get(name)!);
        if (!winner) continue;
        const a = winner.action as TaxAction;
        assertPercent(a.ratePercent, `tax rule ${winner.id} ratePercent`, 100);
        const amount = a.inclusive
          ? inclusiveTaxPortion(netBeforeTax, a.ratePercent)
          : percentOf(netBeforeTax, a.ratePercent);
        taxes.push({ name, amount, inclusive: a.inclusive, ruleId: winner.id });
        push({
          step: 'TAX',
          status: 'APPLIED',
          description: `${name} ${a.ratePercent}% (${a.inclusive ? 'included in price' : 'added'})`,
          ruleId: winner.id,
          ruleVersion: winner.version,
          ruleName: winner.name,
          tier: winner.tier,
          inputAmount: netBeforeTax,
          amount: a.inclusive ? 0 : amount,
          runningTotal:
            netBeforeTax +
            taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0),
        });
        recordLosers('TAX', winner, losers);
      }
    }
  }
  const taxAdded = taxes
    .filter((t) => !t.inclusive)
    .reduce((s, t) => s + t.amount, 0);
  const taxIncluded = taxes
    .filter((t) => t.inclusive)
    .reduce((s, t) => s + t.amount, 0);

  const customerPrice = netBeforeTax + taxAdded;
  const revenueExTax = Math.max(0, netBeforeTax - taxIncluded);
  const margin = revenueExTax - ctx.supplierCost;
  const marginPercent =
    revenueExTax > 0 ? Math.round((margin / revenueExTax) * 10_000) / 100 : 0;

  // ---- Margin protection
  const violations: string[] = [];
  const policy = input.marginPolicy;
  if (margin < 0)
    violations.push(`NEGATIVE_MARGIN: price is ${-margin} below supplier cost`);
  if (policy?.minAbsolute !== undefined && margin < policy.minAbsolute) {
    violations.push(
      `BELOW_MIN_ABSOLUTE_MARGIN: margin ${margin} < required ${policy.minAbsolute}`,
    );
  }
  if (policy?.minPercent !== undefined && marginPercent < policy.minPercent) {
    violations.push(
      `BELOW_MIN_PERCENT_MARGIN: margin ${marginPercent}% < required ${policy.minPercent}%`,
    );
  }

  let status: PricingResult['status'] = 'OK';
  if (violations.length > 0) {
    const ov = input.override;
    if (ov && ov.approvedBy.trim() && ov.reason.trim()) {
      push({
        step: 'OVERRIDE',
        status: 'APPLIED',
        description: `Margin override approved by ${ov.approvedBy}`,
        amount: 0,
        note: `Reason: ${ov.reason}. Overridden: ${violations.join(' | ')}`,
      });
    } else {
      status = 'REQUIRES_OVERRIDE';
      push({
        step: 'MARGIN',
        status: 'SKIPPED',
        description:
          'Margin protection triggered — an authorised override with a reason is required',
        amount: 0,
        note: violations.join(' | '),
      });
    }
  }

  const breakdown: PricingBreakdown = {
    currency,
    supplierCost: ctx.supplierCost,
    markup,
    fees,
    totalFees,
    dynamicAdjustment,
    subtotal,
    discount,
    netBeforeTax,
    taxes,
    taxAdded,
    taxIncluded,
    customerPrice,
    revenueExTax,
    margin,
    marginPercent,
  };

  push({
    step: 'RESULT',
    status: 'APPLIED',
    description: 'Customer price',
    amount: customerPrice,
    runningTotal: customerPrice,
  });

  const appliedRules = Array.from(
    new Map(
      trace
        .filter(
          (t) =>
            (t.status === 'APPLIED' || t.status === 'CLAMPED') &&
            t.ruleId &&
            t.ruleVersion !== undefined,
        )
        .map((t) => [
          `${t.ruleId}@${t.ruleVersion}`,
          { id: t.ruleId as string, version: t.ruleVersion as number },
        ]),
    ).values(),
  );

  return {
    status,
    breakdown,
    trace,
    violations,
    engineVersion: PRICING_ENGINE_VERSION,
    calculatedAt: now.toISOString(),
    appliedRules,
  };
}
