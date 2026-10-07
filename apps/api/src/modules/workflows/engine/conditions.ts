/**
 * Phase 21 — the workflow condition language.
 *
 * Conditions are DATA, never code: a tree of AND / OR / NOT groups over
 * `field operator value` leaves. The evaluator is a small interpreter over that
 * tree — it never calls eval, Function, a regular expression supplied by the
 * author, or any method on the data being inspected — so an administrator cannot
 * make a condition do anything except compare values. It is pure and
 * deterministic: the same condition and context always give the same result and
 * the same trace.
 *
 * Fields are dotted paths into the event/entity context (`booking.totalAmount`).
 * A path may only contain letters, digits, `_` and `.`, and may never touch
 * `__proto__`, `constructor` or `prototype`, so a path cannot reach into the
 * object model. An absent field never throws: comparison operators give false,
 * `notExists` gives true.
 */

export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
  'exists',
  'notExists',
  'dateBefore',
  'dateAfter',
  'dateBetween',
] as const;

export type Operator = (typeof OPERATORS)[number];

export interface LeafCondition {
  field: string;
  op: Operator;
  /** Unused by exists / notExists. dateBetween takes `{ from, to }`, in/notIn take an array. */
  value?: unknown;
}
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | LeafCondition;

export interface ConditionTraceEntry {
  /** Position in the tree, e.g. `all[1].any[0]`. */
  path: string;
  field: string;
  op: Operator;
  /** The value found in the context, truncated and with objects summarised — traces are stored. */
  actual: unknown;
  expected: unknown;
  result: boolean;
  /** Why a comparison could not be made (missing field, wrong type, bad date). */
  note?: string;
}

export interface ConditionResult {
  result: boolean;
  trace: ConditionTraceEntry[];
}

export interface ConditionIssue {
  path: string;
  message: string;
}

export const LIMITS = {
  maxDepth: 6,
  maxNodes: 100,
  maxListItems: 200,
  maxStringLength: 500,
  maxPathLength: 120,
} as const;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export function isSafePath(path: unknown): path is string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > LIMITS.maxPathLength
  )
    return false;
  if (!PATH_RE.test(path)) return false;
  return !path.split('.').some((s) => FORBIDDEN_SEGMENTS.has(s));
}

/** Read a dotted path without ever reaching a prototype member. Missing at any step -> undefined. */
export function readPath(context: unknown, path: string): unknown {
  if (!isSafePath(path)) return undefined;
  let cur: unknown = context;
  for (const segment of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, segment)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** Structural validation. Returns every problem, so an author sees them all at once. */
export function validateCondition(
  condition: unknown,
  opts: { allowedFields?: ReadonlySet<string> } = {},
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  let nodes = 0;

  const walk = (c: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > LIMITS.maxNodes) {
      if (nodes === LIMITS.maxNodes + 1)
        issues.push({
          path,
          message: `A condition may have at most ${LIMITS.maxNodes} parts`,
        });
      return;
    }
    if (depth > LIMITS.maxDepth) {
      issues.push({
        path,
        message: `Conditions may nest at most ${LIMITS.maxDepth} levels deep`,
      });
      return;
    }
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      issues.push({ path, message: 'A condition must be an object' });
      return;
    }
    const obj = c as Record<string, unknown>;
    const keys = Object.keys(obj);

    if ('all' in obj || 'any' in obj) {
      const key = 'all' in obj ? 'all' : 'any';
      if (keys.length !== 1)
        issues.push({ path, message: `A group must contain only "${key}"` });
      const list = obj[key];
      if (!Array.isArray(list) || list.length === 0) {
        issues.push({
          path,
          message: `"${key}" needs a non-empty list of conditions`,
        });
        return;
      }
      list.forEach((child, i) =>
        walk(child, `${path}${path ? '.' : ''}${key}[${i}]`, depth + 1),
      );
      return;
    }
    if ('not' in obj) {
      if (keys.length !== 1)
        issues.push({ path, message: 'A "not" group must contain only "not"' });
      walk(obj.not, `${path}${path ? '.' : ''}not`, depth + 1);
      return;
    }

    // Leaf
    for (const k of keys) {
      if (k !== 'field' && k !== 'op' && k !== 'value')
        issues.push({ path, message: `Unknown key "${k}"` });
    }
    if (!isSafePath(obj.field)) {
      issues.push({
        path,
        message:
          'field must be a plain dotted path such as booking.totalAmount',
      });
    } else if (
      opts.allowedFields &&
      !fieldAllowed(obj.field, opts.allowedFields)
    ) {
      issues.push({
        path,
        message: `field "${obj.field}" is not available for this trigger`,
      });
    }
    if (
      typeof obj.op !== 'string' ||
      !(OPERATORS as readonly string[]).includes(obj.op)
    ) {
      issues.push({
        path,
        message: `op must be one of: ${OPERATORS.join(', ')}`,
      });
      return;
    }
    const op = obj.op as Operator;
    const needsValue = op !== 'exists' && op !== 'notExists';
    if (needsValue && !('value' in obj))
      issues.push({ path, message: `"${op}" needs a value` });
    if (!needsValue && 'value' in obj)
      issues.push({ path, message: `"${op}" does not take a value` });
    if ((op === 'in' || op === 'notIn') && 'value' in obj) {
      if (!Array.isArray(obj.value) || obj.value.length > LIMITS.maxListItems) {
        issues.push({
          path,
          message: `"${op}" needs a list of at most ${LIMITS.maxListItems} items`,
        });
      } else if (obj.value.some((v) => !isScalar(v))) {
        issues.push({
          path,
          message: `"${op}" lists may only contain text, numbers and true/false`,
        });
      }
    }
    if (op === 'dateBetween' && 'value' in obj) {
      const v = obj.value as { from?: unknown; to?: unknown } | null;
      if (
        !v ||
        typeof v !== 'object' ||
        toTime(v.from) === null ||
        toTime(v.to) === null
      ) {
        issues.push({
          path,
          message: 'dateBetween needs { "from": date, "to": date }',
        });
      } else if ((toTime(v.from) as number) > (toTime(v.to) as number)) {
        issues.push({
          path,
          message: 'dateBetween "from" must not be after "to"',
        });
      }
    }
    if (
      (op === 'dateBefore' || op === 'dateAfter') &&
      'value' in obj &&
      toTime(obj.value) === null
    ) {
      issues.push({ path, message: `${op} needs a valid date` });
    }
    if (
      ['gt', 'lt', 'gte', 'lte'].includes(op) &&
      'value' in obj &&
      typeof obj.value !== 'number'
    ) {
      issues.push({ path, message: `${op} needs a number` });
    }
    if (
      ['contains', 'startsWith', 'endsWith'].includes(op) &&
      'value' in obj &&
      !isScalar(obj.value)
    ) {
      issues.push({ path, message: `${op} needs a text or number value` });
    }
    if (
      typeof obj.value === 'string' &&
      obj.value.length > LIMITS.maxStringLength
    ) {
      issues.push({
        path,
        message: `Text values may be at most ${LIMITS.maxStringLength} characters`,
      });
    }
  };

  walk(condition, '', 1);
  return issues;
}

/** An allowed-fields entry ending in .* allows everything beneath that prefix (e.g. steps.*). */
export function fieldAllowed(
  field: string,
  allowed: ReadonlySet<string>,
): boolean {
  if (allowed.has(field)) return true;
  for (const a of allowed)
    if (a.endsWith('.*') && field.startsWith(a.slice(0, -1))) return true;
  return false;
}

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  );
}

/** Dates are only ever ISO strings, Date objects or epoch milliseconds; anything else is "not a date". */
function toTime(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)
  ) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** What goes into a stored trace: short, and never a whole object graph. */
function forTrace(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return `[list of ${v.length}]`;
  return '[object]';
}

export class ConditionError extends Error {}

/**
 * Evaluate a condition. Throws ConditionError for a malformed condition (it should
 * never have been activated); a merely unanswerable comparison is `false` with a note.
 */
export function evaluateCondition(
  condition: Condition,
  context: unknown,
): ConditionResult {
  const issues = validateCondition(condition);
  if (issues.length > 0) {
    throw new ConditionError(
      `Invalid condition: ${issues.map((i) => `${i.path || 'root'}: ${i.message}`).join('; ')}`,
    );
  }
  const trace: ConditionTraceEntry[] = [];

  const run = (c: Condition, path: string): boolean => {
    if ('all' in c) {
      // Deliberately no short-circuit: the trace shows every part, which is what an author debugging needs.
      const results = c.all.map((child, i) =>
        run(child, `${path}${path ? '.' : ''}all[${i}]`),
      );
      return results.every(Boolean);
    }
    if ('any' in c) {
      const results = c.any.map((child, i) =>
        run(child, `${path}${path ? '.' : ''}any[${i}]`),
      );
      return results.some(Boolean);
    }
    if ('not' in c) return !run(c.not, `${path}${path ? '.' : ''}not`);
    const leaf = c;
    const actual = readPath(context, leaf.field);
    const { result, note } = compare(leaf.op, actual, leaf.value);
    trace.push({
      path: path || 'root',
      field: leaf.field,
      op: leaf.op,
      actual: forTrace(actual),
      expected: forTrace(leaf.value),
      result,
      ...(note ? { note } : {}),
    });
    return result;
  };

  return { result: run(condition, ''), trace };
}

function compare(
  op: Operator,
  actual: unknown,
  expected: unknown,
): { result: boolean; note?: string } {
  const missing = actual === undefined || actual === null;
  switch (op) {
    case 'exists':
      return { result: !missing && actual !== '' };
    case 'notExists':
      return { result: missing || actual === '' };
    case 'eq':
      return missing
        ? { result: false, note: 'field is missing' }
        : { result: looseEqual(actual, expected) };
    case 'neq':
      return { result: missing ? true : !looseEqual(actual, expected) };
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      if (missing) return { result: false, note: 'field is missing' };
      if (
        typeof actual !== 'number' ||
        typeof expected !== 'number' ||
        Number.isNaN(actual)
      ) {
        return { result: false, note: 'both sides must be numbers' };
      }
      return {
        result:
          op === 'gt'
            ? actual > expected
            : op === 'lt'
              ? actual < expected
              : op === 'gte'
                ? actual >= expected
                : actual <= expected,
      };
    }
    case 'contains': {
      if (missing) return { result: false, note: 'field is missing' };
      if (typeof actual === 'string' && isScalar(expected))
        return {
          result: actual.toLowerCase().includes(String(expected).toLowerCase()),
        };
      if (Array.isArray(actual))
        return { result: actual.some((x) => looseEqual(x, expected)) };
      return { result: false, note: 'contains works on text or lists' };
    }
    case 'startsWith':
    case 'endsWith': {
      if (typeof actual !== 'string' || !isScalar(expected))
        return {
          result: false,
          note: missing ? 'field is missing' : 'needs text',
        };
      const a = actual.toLowerCase();
      const e = String(expected).toLowerCase();
      return { result: op === 'startsWith' ? a.startsWith(e) : a.endsWith(e) };
    }
    case 'in':
    case 'notIn': {
      const list = Array.isArray(expected) ? expected : [];
      const found = !missing && list.some((x) => looseEqual(actual, x));
      return { result: op === 'in' ? found : !found };
    }
    case 'dateBefore':
    case 'dateAfter':
    case 'dateBetween': {
      const t = toTime(actual);
      if (t === null)
        return {
          result: false,
          note: missing ? 'field is missing' : 'field is not a valid date',
        };
      if (op === 'dateBefore')
        return { result: t < (toTime(expected) as number) };
      if (op === 'dateAfter')
        return { result: t > (toTime(expected) as number) };
      const { from, to } = expected as { from: unknown; to: unknown };
      return {
        result: t >= (toTime(from) as number) && t <= (toTime(to) as number),
      };
    }
  }
}

/** Equal for scalars and dates only; objects never compare equal (no deep walks on untrusted data). */
function looseEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = toTime(a);
    const tb = toTime(b);
    return ta !== null && tb !== null && ta === tb;
  }
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return false;
}
