/**
 * Phase 20 — period maths for dashboards. Pure and deterministic: "now" and the
 * timezone offset are passed in, never read from the environment, so a range is
 * reproducible (and testable) and a stored snapshot can name exactly the window
 * it covered.
 *
 * A range is half-open: [start, end). Day boundaries are computed in the
 * organisation's local time (default Africa/Lagos, UTC+1, no daylight saving),
 * expressed as a fixed offset in minutes.
 */

export type RangePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'PREVIOUS_MONTH'
  | 'THIS_QUARTER'
  | 'THIS_YEAR'
  | 'CUSTOM';

export type ComparisonKind =
  'PREVIOUS_PERIOD' | 'PREVIOUS_MONTH' | 'PREVIOUS_QUARTER' | 'PREVIOUS_YEAR';

export interface DateRange {
  preset: RangePreset | 'COMPARISON';
  start: Date; // inclusive
  end: Date; // exclusive
  label: string;
}

export const LAGOS_OFFSET_MINUTES = 60;

const DAY_MS = 86_400_000;

export class PeriodError extends Error {}

/** A local calendar date broken into parts, in the organisation's timezone. */
interface LocalParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
}

function localParts(instant: Date, offsetMinutes: number): LocalParts {
  const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** The UTC instant at which the given LOCAL calendar date begins. Month/day overflow rolls over normally. */
function localStart(
  year: number,
  month: number,
  day: number,
  offsetMinutes: number,
): Date {
  return new Date(Date.UTC(year, month, day) - offsetMinutes * 60_000);
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function fmt(d: Date, offsetMinutes: number): string {
  const p = localParts(d, offsetMinutes);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

export interface ResolveOptions {
  tzOffsetMinutes?: number;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  /** Required for CUSTOM: inclusive local dates, as ISO yyyy-mm-dd. */
  from?: string;
  to?: string;
}

function parseLocalDate(
  iso: string,
  label: string,
): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new PeriodError(`${label} must be a date like 2026-10-31`);
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(Date.UTC(year, month, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    throw new PeriodError(`${label} is not a real calendar date: ${iso}`);
  }
  return { year, month, day };
}

export function resolveRange(
  preset: RangePreset,
  now: Date,
  opts: ResolveOptions = {},
): DateRange {
  const off = opts.tzOffsetMinutes ?? LAGOS_OFFSET_MINUTES;
  const t = localParts(now, off);
  const make = (start: Date, end: Date, label: string): DateRange => ({
    preset,
    start,
    end,
    label,
  });

  switch (preset) {
    case 'TODAY':
      return make(
        localStart(t.year, t.month, t.day, off),
        localStart(t.year, t.month, t.day + 1, off),
        'Today',
      );
    case 'YESTERDAY':
      return make(
        localStart(t.year, t.month, t.day - 1, off),
        localStart(t.year, t.month, t.day, off),
        'Yesterday',
      );
    case 'THIS_WEEK': {
      const weekStart = opts.weekStartsOn ?? 1;
      const back = (t.weekday - weekStart + 7) % 7;
      return make(
        localStart(t.year, t.month, t.day - back, off),
        localStart(t.year, t.month, t.day - back + 7, off),
        'This week',
      );
    }
    case 'THIS_MONTH':
      return make(
        localStart(t.year, t.month, 1, off),
        localStart(t.year, t.month + 1, 1, off),
        'This month',
      );
    case 'PREVIOUS_MONTH':
      return make(
        localStart(t.year, t.month - 1, 1, off),
        localStart(t.year, t.month, 1, off),
        'Previous month',
      );
    case 'THIS_QUARTER': {
      const q = Math.floor(t.month / 3) * 3;
      return make(
        localStart(t.year, q, 1, off),
        localStart(t.year, q + 3, 1, off),
        'This quarter',
      );
    }
    case 'THIS_YEAR':
      return make(
        localStart(t.year, 0, 1, off),
        localStart(t.year + 1, 0, 1, off),
        'This year',
      );
    case 'CUSTOM': {
      if (!opts.from || !opts.to)
        throw new PeriodError('A custom range needs both from and to');
      const a = parseLocalDate(opts.from, 'from');
      const b = parseLocalDate(opts.to, 'to');
      const start = localStart(a.year, a.month, a.day, off);
      const end = localStart(b.year, b.month, b.day + 1, off); // `to` is inclusive
      if (end <= start)
        throw new PeriodError('The end date must not be before the start date');
      // A runaway range would turn a dashboard into a full-table scan.
      if ((end.getTime() - start.getTime()) / DAY_MS > 366 * 3)
        throw new PeriodError('A custom range can span at most three years');
      return make(
        start,
        end,
        `${fmt(start, off)} – ${fmt(new Date(end.getTime() - 1), off)}`,
      );
    }
  }
}

/**
 * The window a range should be compared against.
 *  - PREVIOUS_PERIOD: the equally long window ending where this one starts.
 *  - PREVIOUS_MONTH / QUARTER / YEAR: this window shifted back by that many
 *    calendar months, so "this month so far" is compared with the SAME days of
 *    the previous month (a fair comparison), clamped when that month is shorter.
 */
export function comparisonRange(
  range: DateRange,
  kind: ComparisonKind,
  opts: { tzOffsetMinutes?: number } = {},
): DateRange {
  const off = opts.tzOffsetMinutes ?? LAGOS_OFFSET_MINUTES;
  if (kind === 'PREVIOUS_PERIOD') {
    const length = range.end.getTime() - range.start.getTime();
    const end = range.start;
    const start = new Date(end.getTime() - length);
    return {
      preset: 'COMPARISON',
      start,
      end,
      label: `Previous period (${fmt(start, off)} – ${fmt(new Date(end.getTime() - 1), off)})`,
    };
  }
  const months =
    kind === 'PREVIOUS_MONTH' ? 1 : kind === 'PREVIOUS_QUARTER' ? 3 : 12;
  const shift = (instant: Date): Date => {
    const p = localParts(instant, off);
    const targetMonthIndex = p.year * 12 + p.month - months;
    const year = Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;
    const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(p.day, daysInTarget);
    const msIntoDay =
      instant.getTime() + off * 60_000 - Date.UTC(p.year, p.month, p.day);
    return new Date(Date.UTC(year, month, day) + msIntoDay - off * 60_000);
  };
  const start = shift(range.start);
  const end = shift(range.end);
  const noun =
    kind === 'PREVIOUS_MONTH'
      ? 'month'
      : kind === 'PREVIOUS_QUARTER'
        ? 'quarter'
        : 'year';
  return {
    preset: 'COMPARISON',
    start,
    end,
    label: `Same period, previous ${noun}`,
  };
}

/**
 * Like-for-like comparison for a period that has not finished yet.
 * Comparing "this month so far" (6 days) with the WHOLE previous month would show
 * a fake collapse, so while a period is in progress the comparison window is cut to
 * the same elapsed length. A finished period is compared in full, unchanged.
 */
export function comparisonRangeToDate(
  range: DateRange,
  kind: ComparisonKind,
  now: Date,
  opts: { tzOffsetMinutes?: number } = {},
): { range: DateRange; inProgress: boolean } | null {
  const off = opts.tzOffsetMinutes ?? LAGOS_OFFSET_MINUTES;
  const elapsedMs = now.getTime() - range.start.getTime();
  if (elapsedMs <= 0) return null; // the period has not started, so there is nothing to compare yet
  const full = comparisonRange(range, kind, opts);
  const inProgress = now.getTime() < range.end.getTime();
  if (!inProgress) return { range: full, inProgress: false };
  const end = new Date(
    Math.min(full.end.getTime(), full.start.getTime() + elapsedMs),
  );
  const label =
    kind === 'PREVIOUS_PERIOD'
      ? `Previous period, same elapsed time (${fmt(full.start, off)} – ${fmt(new Date(end.getTime() - 1), off)})`
      : `${full.label}, same elapsed time`;
  return { range: { ...full, end, label }, inProgress: true };
}

export type ComparisonStatus = 'OK' | 'NO_BASELINE' | 'INSUFFICIENT_DATA';

export interface Comparison {
  current: number;
  previous: number | null;
  change: number | null;
  /** null whenever a percentage would be meaningless (no baseline, or a zero baseline). Never invented. */
  changePercent: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | null;
  status: ComparisonStatus;
  note?: string;
}

/**
 * Compare a value with its baseline WITHOUT inventing a comparison:
 *  - previous === null  -> NO_BASELINE (the baseline period predates our data)
 *  - previous === 0     -> a % change is undefined, so none is shown
 *  - baselineHasData=false -> INSUFFICIENT_DATA (the previous window had no records at all)
 */
export function compareValues(
  current: number,
  previous: number | null,
  baselineHasData = true,
): Comparison {
  // The period predating our data is the stronger statement, so it wins even when the
  // baseline figure is also null (e.g. an average over no bookings).
  if (!baselineHasData) {
    return {
      current,
      previous,
      change: null,
      changePercent: null,
      direction: null,
      status: 'INSUFFICIENT_DATA',
      note: 'The comparison period has no records yet',
    };
  }
  if (previous === null) {
    return {
      current,
      previous: null,
      change: null,
      changePercent: null,
      direction: null,
      status: 'NO_BASELINE',
      note: 'No data for the comparison period',
    };
  }
  const change = current - previous;
  const direction = change === 0 ? 'FLAT' : change > 0 ? 'UP' : 'DOWN';
  if (previous === 0) {
    return {
      current,
      previous,
      change,
      changePercent: null,
      direction,
      status: 'OK',
      note: 'Growth is undefined against a zero baseline',
    };
  }
  return {
    current,
    previous,
    change,
    changePercent: Math.round((change / Math.abs(previous)) * 10_000) / 100,
    direction,
    status: 'OK',
  };
}

export interface AgeingBucketDef {
  key: string;
  label: string;
  /** Inclusive lower bound in days overdue. */
  minDays: number;
  /** Inclusive upper bound; null = open-ended. */
  maxDays: number | null;
}

/** Thresholds are configuration, not constants: pass your own list. This is the default 0 / 30 / 60 / 90 split. */
export const DEFAULT_AGEING_THRESHOLDS = [30, 60, 90] as const;

export function buildAgeingBuckets(
  thresholds: readonly number[] = DEFAULT_AGEING_THRESHOLDS,
): AgeingBucketDef[] {
  const sorted = [...thresholds].sort((a, b) => a - b);
  if (
    sorted.some((n) => !Number.isInteger(n) || n <= 0) ||
    new Set(sorted).size !== sorted.length
  ) {
    throw new PeriodError(
      'Ageing thresholds must be distinct positive whole numbers of days',
    );
  }
  const buckets: AgeingBucketDef[] = [
    {
      key: 'CURRENT',
      label: 'Current (not yet due)',
      minDays: Number.NEGATIVE_INFINITY,
      maxDays: 0,
    },
  ];
  let lower = 1;
  for (const t of sorted) {
    buckets.push({
      key: `D${lower}_${t}`,
      label: `${lower}–${t} days`,
      minDays: lower,
      maxDays: t,
    });
    lower = t + 1;
  }
  buckets.push({
    key: `D${lower}_PLUS`,
    label: `Over ${sorted[sorted.length - 1]} days`,
    minDays: lower,
    maxDays: null,
  });
  return buckets;
}

/** Whole days an item is past its due date (negative or zero = not yet due). */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - dueDate.getTime()) / DAY_MS);
}

export function bucketFor(
  days: number,
  buckets: AgeingBucketDef[],
): AgeingBucketDef {
  const match = buckets.find(
    (b) => days >= b.minDays && (b.maxDays === null || days <= b.maxDays),
  );
  // The first bucket is unbounded below and the last unbounded above, so a match always exists.
  return match ?? buckets[buckets.length - 1];
}
