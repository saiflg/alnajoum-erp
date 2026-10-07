/**
 * Phase 21 — schedule triggers (hourly / daily / weekly / monthly).
 *
 * Pure date maths: given a schedule and "now", find the most recent instant the
 * schedule says it should have fired. The scheduler compares that window with the
 * workflow's `scheduleLastFiredAt` and fires only when a NEW window has opened, so
 * a window fires exactly once — across restarts and across several API instances
 * (the claim is an atomic conditional update; see WorkflowSchedulerService).
 * Times are in the organisation's local time (default Africa/Lagos, UTC+1, no DST).
 */
import { LAGOS_OFFSET_MINUTES } from '../../analytics/engine/periods';

export const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface ScheduleConfig {
  frequency: Frequency;
  /** 0-59. For HOURLY it is the minute past each hour; otherwise the minute of the chosen hour. Default 0. */
  minute?: number;
  /** 0-23 local hour (DAILY / WEEKLY / MONTHLY). Default 0. */
  hour?: number;
  /** 1 = Monday … 7 = Sunday (WEEKLY). */
  dayOfWeek?: number;
  /** 1-28 (MONTHLY). 29-31 are refused because not every month has them. */
  dayOfMonth?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const inRange = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function validateSchedule(s: unknown): string[] {
  if (!s || typeof s !== 'object') return ['A schedule must be an object'];
  const c = s as Partial<ScheduleConfig>;
  const errors: string[] = [];
  if (
    !c.frequency ||
    !(FREQUENCIES as readonly string[]).includes(c.frequency)
  ) {
    return [`frequency must be one of ${FREQUENCIES.join(', ')}`];
  }
  if (c.minute !== undefined && !inRange(c.minute, 0, 59))
    errors.push('minute must be a whole number from 0 to 59');
  if (c.hour !== undefined && !inRange(c.hour, 0, 23))
    errors.push('hour must be a whole number from 0 to 23');
  if (c.frequency === 'HOURLY' && c.hour !== undefined)
    errors.push('an hourly schedule has no hour');
  if (c.frequency === 'WEEKLY' && !inRange(c.dayOfWeek, 1, 7))
    errors.push(
      'a weekly schedule needs dayOfWeek from 1 (Monday) to 7 (Sunday)',
    );
  if (c.frequency !== 'WEEKLY' && c.dayOfWeek !== undefined)
    errors.push('dayOfWeek only applies to weekly schedules');
  if (c.frequency === 'MONTHLY' && !inRange(c.dayOfMonth, 1, 28))
    errors.push('a monthly schedule needs dayOfMonth from 1 to 28');
  if (c.frequency !== 'MONTHLY' && c.dayOfMonth !== undefined)
    errors.push('dayOfMonth only applies to monthly schedules');
  return errors;
}

/** The most recent scheduled instant at or before `now` (a Date in real UTC time). */
export function lastWindowStart(
  schedule: ScheduleConfig,
  now: Date,
  offsetMinutes = LAGOS_OFFSET_MINUTES,
): Date {
  const off = offsetMinutes * 60_000;
  const local = new Date(now.getTime() + off); // read its UTC fields as local fields
  const minute = schedule.minute ?? 0;
  const hour = schedule.hour ?? 0;
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const toReal = (localMs: number): Date => new Date(localMs - off);
  const nowMs = now.getTime();

  switch (schedule.frequency) {
    case 'HOURLY': {
      let t = Date.UTC(y, mo, d, local.getUTCHours(), minute);
      if (toReal(t).getTime() > nowMs) t -= HOUR;
      return toReal(t);
    }
    case 'DAILY': {
      let t = Date.UTC(y, mo, d, hour, minute);
      if (toReal(t).getTime() > nowMs) t -= DAY;
      return toReal(t);
    }
    case 'WEEKLY': {
      const isoDow = ((local.getUTCDay() + 6) % 7) + 1; // 1 = Monday
      const back = (isoDow - (schedule.dayOfWeek ?? 1) + 7) % 7;
      let t = Date.UTC(y, mo, d - back, hour, minute);
      if (toReal(t).getTime() > nowMs) t -= 7 * DAY;
      return toReal(t);
    }
    case 'MONTHLY': {
      let t = Date.UTC(y, mo, schedule.dayOfMonth ?? 1, hour, minute);
      if (toReal(t).getTime() > nowMs)
        t = Date.UTC(y, mo - 1, schedule.dayOfMonth ?? 1, hour, minute);
      return toReal(t);
    }
  }
}

/** True when a window has opened since the schedule last fired. */
export function isDue(
  schedule: ScheduleConfig,
  lastFiredAt: Date | null,
  now: Date,
): { due: boolean; window: Date } {
  const window = lastWindowStart(schedule, now);
  return {
    due: lastFiredAt === null || lastFiredAt.getTime() < window.getTime(),
    window,
  };
}
