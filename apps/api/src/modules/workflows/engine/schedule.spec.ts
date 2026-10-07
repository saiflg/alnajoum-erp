import { isDue, lastWindowStart, validateSchedule } from './schedule';

// Local = UTC+1. Wed 7 Oct 2026, 14:30 local = 13:30Z.
const NOW = new Date('2026-10-07T13:30:00.000Z');
const iso = (d: Date) => d.toISOString();

describe('lastWindowStart (Lagos, UTC+1)', () => {
  it('HOURLY: the most recent minute-past-the-hour', () => {
    expect(iso(lastWindowStart({ frequency: 'HOURLY', minute: 15 }, NOW))).toBe(
      '2026-10-07T13:15:00.000Z',
    ); // 14:15 local
    expect(iso(lastWindowStart({ frequency: 'HOURLY', minute: 45 }, NOW))).toBe(
      '2026-10-07T12:45:00.000Z',
    ); // 13:45 local
  });
  it('DAILY: today if the time has passed, else yesterday', () => {
    expect(iso(lastWindowStart({ frequency: 'DAILY', hour: 9 }, NOW))).toBe(
      '2026-10-07T08:00:00.000Z',
    ); // 09:00 local today
    expect(iso(lastWindowStart({ frequency: 'DAILY', hour: 18 }, NOW))).toBe(
      '2026-10-06T17:00:00.000Z',
    ); // 18:00 local yesterday
  });
  it('DAILY uses the LOCAL date: 23:30Z is already tomorrow in Lagos', () => {
    const late = new Date('2026-10-07T23:30:00.000Z'); // 00:30 local on the 8th
    expect(iso(lastWindowStart({ frequency: 'DAILY', hour: 0 }, late))).toBe(
      '2026-10-07T23:00:00.000Z',
    );
  });
  it('WEEKLY: the most recent chosen weekday', () => {
    // Wed 7 Oct. Monday 09:00 local was 5 Oct.
    expect(
      iso(lastWindowStart({ frequency: 'WEEKLY', dayOfWeek: 1, hour: 9 }, NOW)),
    ).toBe('2026-10-05T08:00:00.000Z');
    // Wednesday 09:00 local was this morning; Wednesday 18:00 is still ahead, so last week's.
    expect(
      iso(lastWindowStart({ frequency: 'WEEKLY', dayOfWeek: 3, hour: 9 }, NOW)),
    ).toBe('2026-10-07T08:00:00.000Z');
    expect(
      iso(
        lastWindowStart({ frequency: 'WEEKLY', dayOfWeek: 3, hour: 18 }, NOW),
      ),
    ).toBe('2026-09-30T17:00:00.000Z');
    // Sunday (7)
    expect(
      iso(lastWindowStart({ frequency: 'WEEKLY', dayOfWeek: 7, hour: 0 }, NOW)),
    ).toBe('2026-10-03T23:00:00.000Z');
  });
  it('MONTHLY: this month if reached, else last month (across a year boundary too)', () => {
    expect(
      iso(
        lastWindowStart({ frequency: 'MONTHLY', dayOfMonth: 1, hour: 8 }, NOW),
      ),
    ).toBe('2026-10-01T07:00:00.000Z');
    expect(
      iso(
        lastWindowStart({ frequency: 'MONTHLY', dayOfMonth: 15, hour: 8 }, NOW),
      ),
    ).toBe('2026-09-15T07:00:00.000Z');
    const jan = new Date('2027-01-05T10:00:00.000Z');
    expect(
      iso(
        lastWindowStart({ frequency: 'MONTHLY', dayOfMonth: 20, hour: 8 }, jan),
      ),
    ).toBe('2026-12-20T07:00:00.000Z');
  });
  it('is never in the future', () => {
    for (const s of [
      { frequency: 'HOURLY', minute: 59 },
      { frequency: 'DAILY', hour: 23, minute: 59 },
      { frequency: 'WEEKLY', dayOfWeek: 2, hour: 23 },
      { frequency: 'MONTHLY', dayOfMonth: 28, hour: 23 },
    ] as const) {
      expect(lastWindowStart(s, NOW).getTime()).toBeLessThanOrEqual(
        NOW.getTime(),
      );
    }
  });
});

describe('isDue — a window fires exactly once', () => {
  const s = { frequency: 'DAILY', hour: 9 } as const;
  it('fires when never fired', () => {
    expect(isDue(s, null, NOW).due).toBe(true);
  });
  it('does not fire again for the same window', () => {
    const { window } = isDue(s, null, NOW);
    expect(isDue(s, window, NOW).due).toBe(false);
    expect(isDue(s, new Date(window.getTime() + 60_000), NOW).due).toBe(false);
  });
  it('fires again once the next window opens', () => {
    const { window } = isDue(s, null, NOW);
    const nextDay = new Date(NOW.getTime() + 24 * 3600_000);
    expect(isDue(s, window, nextDay).due).toBe(true);
  });
  it('after downtime it fires ONCE for the latest window, not once per missed window', () => {
    const { window } = isDue(s, null, NOW);
    const weekLater = new Date(NOW.getTime() + 7 * 24 * 3600_000);
    const r = isDue(s, window, weekLater);
    expect(r.due).toBe(true);
    expect(isDue(s, r.window, weekLater).due).toBe(false);
  });
});

describe('validateSchedule', () => {
  it('accepts good schedules', () => {
    for (const s of [
      { frequency: 'HOURLY', minute: 5 },
      { frequency: 'DAILY', hour: 8 },
      { frequency: 'WEEKLY', dayOfWeek: 2, hour: 8 },
      { frequency: 'MONTHLY', dayOfMonth: 28, hour: 8 },
    ]) {
      expect(validateSchedule(s)).toEqual([]);
    }
  });
  it('rejects bad ones', () => {
    expect(validateSchedule({ frequency: 'YEARLY' })[0]).toContain('frequency');
    expect(validateSchedule({ frequency: 'DAILY', hour: 24 })).toHaveLength(1);
    expect(validateSchedule({ frequency: 'WEEKLY', hour: 9 })[0]).toContain(
      'dayOfWeek',
    );
    expect(
      validateSchedule({ frequency: 'MONTHLY', dayOfMonth: 31 })[0],
    ).toContain('1 to 28');
    expect(validateSchedule({ frequency: 'HOURLY', hour: 3 })[0]).toContain(
      'no hour',
    );
    expect(validateSchedule({ frequency: 'DAILY', dayOfWeek: 2 })[0]).toContain(
      'only applies',
    );
    expect(validateSchedule(null)).toHaveLength(1);
  });
});
