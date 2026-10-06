/**
 * Phase 20 — time-series bucketing. The database groups rows into local-time
 * buckets (see MetricsService.trend); this module produces the FULL list of
 * bucket keys for a range so empty periods appear as an honest zero instead of
 * silently vanishing from a chart. Keys use the same formats the SQL emits:
 * day/week -> YYYY-MM-DD (week = its Monday), month -> YYYY-MM-01.
 */
import { DateRange, LAGOS_OFFSET_MINUTES } from './periods';

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month'];

const DAY_MS = 86_400_000;
/** A chart with more points than this is unreadable, and a query that wide is wasteful. */
export const MAX_POINTS = 400;

/** The finest granularity that keeps a range readable. */
export function defaultGranularity(range: DateRange): Granularity {
  const days = (range.end.getTime() - range.start.getTime()) / DAY_MS;
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function bucketKeys(
  range: DateRange,
  granularity: Granularity,
  offsetMinutes = LAGOS_OFFSET_MINUTES,
): string[] {
  // Work on the local calendar: shift into local time and treat the UTC fields as local fields.
  const startLocal = new Date(range.start.getTime() + offsetMinutes * 60_000);
  const lastLocal = new Date(range.end.getTime() - 1 + offsetMinutes * 60_000);
  const keys: string[] = [];

  if (granularity === 'month') {
    let y = startLocal.getUTCFullYear();
    let m = startLocal.getUTCMonth();
    const endY = lastLocal.getUTCFullYear();
    const endM = lastLocal.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${pad(m + 1)}-01`);
      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
    return keys;
  }

  let cursor = new Date(
    Date.UTC(
      startLocal.getUTCFullYear(),
      startLocal.getUTCMonth(),
      startLocal.getUTCDate(),
    ),
  );
  if (granularity === 'week') {
    const back = (cursor.getUTCDay() + 6) % 7; // back to Monday (SQL date_trunc('week') is ISO Monday)
    cursor = new Date(cursor.getTime() - back * DAY_MS);
  }
  const step = granularity === 'week' ? 7 * DAY_MS : DAY_MS;
  const last = Date.UTC(
    lastLocal.getUTCFullYear(),
    lastLocal.getUTCMonth(),
    lastLocal.getUTCDate(),
  );
  while (cursor.getTime() <= last) {
    keys.push(ymd(cursor));
    cursor = new Date(cursor.getTime() + step);
  }
  return keys;
}

/** Lay sparse database rows over the complete key list, defaulting empty buckets to 0. */
export function fillBuckets(
  keys: string[],
  rows: { key: string; value: number }[],
): { key: string; value: number }[] {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return keys.map((key) => ({ key, value: byKey.get(key) ?? 0 }));
}
