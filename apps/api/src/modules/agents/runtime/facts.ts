import { Confidence, MoneyValue } from '../agent.types';

/**
 * Answers are built from FACTS: the (already filtered) outputs of tool calls. A model writes prose with
 * `{{tool.path}}` placeholders, and the runtime fills them in from the real record. Money is formatted by the
 * runtime from an authoritative {amount, currency} — a model never types a currency figure — and any other
 * number in the model's own prose that is not traceable to a tool result or to the customer's own message is
 * treated as unverified and removed.
 */

export type Facts = Record<string, unknown>;

export const isMoney = (v: unknown): v is MoneyValue =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as MoneyValue).amount === 'number' &&
  typeof (v as MoneyValue).currency === 'string';

export function formatMoney(m: MoneyValue, language = 'en'): string {
  const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-NG';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: m.currency,
      maximumFractionDigits: 0,
    }).format(m.amount);
  } catch {
    // Unknown currency code: show the code rather than guessing a symbol.
    return `${m.currency} ${m.amount.toLocaleString('en-US')}`;
  }
}

function lookup(facts: Facts, path: string): unknown {
  let cur: unknown = facts;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else if (Array.isArray(cur) && /^\d+$/.test(part)) {
      cur = cur[Number(part)];
    } else return undefined;
  }
  return cur;
}

export interface RenderResult {
  text: string;
  /** Placeholders that did not resolve (the answer would have shown nothing for them). */
  missing: string[];
}

export function renderFacts(
  template: string,
  facts: Facts,
  language = 'en',
): RenderResult {
  const missing: string[] = [];
  const text = template.replace(
    /\{\{\s*([A-Za-z0-9_.[\]-]+)\s*\}\}/g,
    (_m, path: string) => {
      const v = lookup(facts, path.replace(/\[(\d+)\]/g, '.$1'));
      if (v === undefined || v === null) {
        missing.push(path);
        return '';
      }
      if (isMoney(v)) return formatMoney(v, language);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
  );
  return { text, missing };
}

const NUM = /(?<![A-Za-z0-9])(?:[₦$£€]\s?)?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/g;

const normaliseNumber = (s: string): string =>
  s.replace(/[₦$£€\s,]/g, '').replace(/\.0+$/, '');

function collectNumbers(value: unknown, into: Set<string>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.add(normaliseNumber(String(value)));
  } else if (typeof value === 'string') {
    for (const m of value.match(NUM) ?? []) into.add(normaliseNumber(m));
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>))
      collectNumbers(v, into);
  }
}

export interface NumberGuardResult {
  text: string;
  /** Numbers in the model's own prose that no tool result or user message supports. */
  unverified: string[];
}

/**
 * The model's raw text (placeholders NOT yet filled in) is checked: every number in it must appear in a tool
 * output or in what the customer/staff member themselves wrote, or be a small count (0–10) or part of a date.
 * A sentence containing an unverified number is replaced, so a hallucinated price or balance never reaches
 * the reader.
 */
export function guardNumbers(
  rawModelText: string,
  facts: Facts,
  userText: string,
  language = 'en',
): NumberGuardResult {
  const allowed = new Set<string>();
  collectNumbers(facts, allowed);
  collectNumbers(userText, allowed);

  const withoutPlaceholders = rawModelText.replace(/\{\{[^}]*\}\}/g, ' ');
  const unverified: string[] = [];
  const sentences = withoutPlaceholders.split(/(?<=[.!?؟])\s+|\n+/);
  const bad = new Set<string>();
  for (const sentence of sentences) {
    // ISO dates and times are structure, not figures.
    const stripped = sentence
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ');
    for (const m of stripped.match(NUM) ?? []) {
      const n = normaliseNumber(m);
      const small = /^\d$/.test(n) || n === '10';
      if (!small && !allowed.has(n)) {
        unverified.push(m);
        bad.add(sentence);
      }
    }
  }
  if (bad.size === 0) return { text: rawModelText, unverified };
  const notice =
    language === 'ar'
      ? 'لا يمكنني التحقق من هذا الرقم من سجلاتك.'
      : language === 'ha'
        ? 'Ba zan iya tabbatar da wannan adadin daga bayananka ba.'
        : 'I could not verify this figure from your records.';
  let text = rawModelText;
  for (const s of bad) text = text.replace(s, notice);
  return { text, unverified };
}

export const CONFIDENCE_ORDER: Confidence[] = [
  'UNKNOWN',
  'LOW',
  'MEDIUM',
  'HIGH',
];
export const lowerConfidence = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_ORDER[
    Math.min(CONFIDENCE_ORDER.indexOf(a), CONFIDENCE_ORDER.indexOf(b))
  ];
