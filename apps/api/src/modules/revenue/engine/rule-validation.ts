import { PricingEngineError } from './pricing-engine';
import {
  PricingRuleInput,
  PricingTier,
  RuleAction,
  RuleConditions,
  TIER_ORDER,
} from './pricing.types';

/**
 * Strict validation of rule JSON before it is stored or priced with. Rule
 * payloads arrive from admin forms and live in Json columns, so nothing about
 * their shape can be assumed. Anything unexpected is rejected rather than
 * coerced: a misconfigured pricing rule must fail loudly, never quietly
 * produce a wrong price.
 */

const STRING_CONDITIONS = [
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
] as const;
const NUMBER_CONDITIONS = [
  'minPassengers',
  'maxPassengers',
  'minAdvanceDays',
  'maxAdvanceDays',
] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(message: string): never {
  throw new PricingEngineError(message);
}

export function validateConditions(raw: unknown): RuleConditions {
  if (!isObject(raw)) fail('conditions must be an object');
  const allowed = new Set<string>([...STRING_CONDITIONS, ...NUMBER_CONDITIONS]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) fail(`Unknown condition "${key}"`);
    if (value === undefined || value === null) continue;
    if ((STRING_CONDITIONS as readonly string[]).includes(key)) {
      if (typeof value !== 'string' || value.trim() === '')
        fail(`Condition "${key}" must be a non-empty string`);
    } else if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      fail(`Condition "${key}" must be a non-negative whole number`);
    }
    out[key] = value;
  }
  const c = out as RuleConditions;
  if (
    c.minPassengers !== undefined &&
    c.maxPassengers !== undefined &&
    c.minPassengers > c.maxPassengers
  ) {
    fail('minPassengers cannot exceed maxPassengers');
  }
  if (
    c.minAdvanceDays !== undefined &&
    c.maxAdvanceDays !== undefined &&
    c.minAdvanceDays > c.maxAdvanceDays
  ) {
    fail('minAdvanceDays cannot exceed maxAdvanceDays');
  }
  return c;
}

function amountMode(
  raw: Record<string, unknown>,
  label: string,
): { mode: 'FIXED' | 'PERCENT'; value: number } {
  if (raw.mode !== 'FIXED' && raw.mode !== 'PERCENT')
    fail(`${label}: mode must be FIXED or PERCENT`);
  const value = raw.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail(`${label}: value must be a non-negative number`);
  if (raw.mode === 'FIXED' && !Number.isInteger(value))
    fail(`${label}: a FIXED value must be a whole number`);
  if (raw.mode === 'PERCENT' && value > 1000)
    fail(`${label}: a PERCENT value cannot exceed 1000`);
  return { mode: raw.mode, value };
}

export function validateAction(raw: unknown): RuleAction {
  if (!isObject(raw)) fail('action must be an object');
  switch (raw.kind) {
    case 'MARKUP':
      return { kind: 'MARKUP', ...amountMode(raw, 'MARKUP') };
    case 'FEE': {
      if (typeof raw.feeType !== 'string' || raw.feeType.trim() === '')
        fail('FEE: feeType is required');
      return {
        kind: 'FEE',
        feeType: raw.feeType.trim().toUpperCase(),
        ...amountMode(raw, 'FEE'),
      };
    }
    case 'DISCOUNT':
      return {
        kind: 'DISCOUNT',
        ...amountMode(raw, 'DISCOUNT'),
        stackable: raw.stackable === true,
      };
    case 'TAX': {
      if (typeof raw.name !== 'string' || raw.name.trim() === '')
        fail('TAX: name is required');
      const r = raw.ratePercent;
      if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 100)
        fail('TAX: ratePercent must be between 0 and 100');
      if (typeof raw.inclusive !== 'boolean')
        fail('TAX: inclusive must be true or false');
      return {
        kind: 'TAX',
        name: raw.name.trim().toUpperCase(),
        ratePercent: r,
        inclusive: raw.inclusive,
      };
    }
    case 'DYNAMIC': {
      if (
        raw.signal !== 'daysToDeparture' &&
        raw.signal !== 'inventoryRemainingPercent'
      ) {
        fail(
          'DYNAMIC: signal must be daysToDeparture or inventoryRemainingPercent',
        );
      }
      if (
        !Array.isArray(raw.bands) ||
        raw.bands.length === 0 ||
        raw.bands.length > 20
      ) {
        fail('DYNAMIC: bands must be a list of 1-20 entries');
      }
      const bands = raw.bands.map((b: unknown, i: number) => {
        if (!isObject(b)) fail(`DYNAMIC: band ${i} must be an object`);
        if (typeof b.upTo !== 'number' || !Number.isFinite(b.upTo))
          fail(`DYNAMIC: band ${i} upTo must be a number`);
        if (
          typeof b.adjustPercent !== 'number' ||
          !Number.isFinite(b.adjustPercent) ||
          Math.abs(b.adjustPercent) > 100
        ) {
          fail(`DYNAMIC: band ${i} adjustPercent must be between -100 and 100`);
        }
        return { upTo: b.upTo, adjustPercent: b.adjustPercent };
      });
      if (!isObject(raw.limits)) fail('DYNAMIC: limits are mandatory');
      const l = raw.limits;
      // A dynamic rule with no movement cap would be an unbounded price — refuse it.
      if (
        typeof l.maxMovementPercent !== 'number' ||
        l.maxMovementPercent < 0 ||
        l.maxMovementPercent > 100
      ) {
        fail('DYNAMIC: limits.maxMovementPercent (0-100) is mandatory');
      }
      const optionalMoney = (k: 'minPrice' | 'maxPrice') => {
        const v = l[k];
        if (v === undefined || v === null) return undefined;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
          fail(`DYNAMIC: limits.${k} must be a non-negative whole number`);
        return v;
      };
      const minPrice = optionalMoney('minPrice');
      const maxPrice = optionalMoney('maxPrice');
      if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice
      )
        fail('DYNAMIC: minPrice cannot exceed maxPrice');
      let maxMarkupPercent: number | undefined;
      if (l.maxMarkupPercent !== undefined && l.maxMarkupPercent !== null) {
        if (
          typeof l.maxMarkupPercent !== 'number' ||
          l.maxMarkupPercent < 0 ||
          l.maxMarkupPercent > 1000
        ) {
          fail('DYNAMIC: limits.maxMarkupPercent must be between 0 and 1000');
        }
        maxMarkupPercent = l.maxMarkupPercent;
      }
      return {
        kind: 'DYNAMIC',
        signal: raw.signal,
        bands,
        limits: {
          maxMovementPercent: l.maxMovementPercent,
          minPrice,
          maxPrice,
          maxMarkupPercent,
        },
      };
    }
    default:
      return fail(`Unknown action kind "${String(raw.kind)}"`);
  }
}

export function validateTier(raw: unknown): PricingTier {
  if (
    typeof raw !== 'string' ||
    !(TIER_ORDER as readonly string[]).includes(raw)
  ) {
    fail(`tier must be one of ${TIER_ORDER.join(', ')}`);
  }
  return raw as PricingTier;
}

/** Turns a stored PricingRule row (with its Json columns) into a validated engine input. */
export function toEngineRule(row: {
  id: string;
  name: string;
  tier: string;
  priority: number;
  isActive: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  currentVersion: number;
  conditions: unknown;
  action: unknown;
}): PricingRuleInput {
  return {
    id: row.id,
    name: row.name,
    version: row.currentVersion,
    tier: validateTier(row.tier),
    priority: row.priority,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    conditions: validateConditions(row.conditions),
    action: validateAction(row.action),
  };
}
