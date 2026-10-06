import {
  bucketFor,
  buildAgeingBuckets,
  compareValues,
  comparisonRange,
  comparisonRangeToDate,
  daysOverdue,
  PeriodError,
  resolveRange,
} from './periods';

const iso = (d: Date) => d.toISOString();
// Monday 5 Oct 2026, 13:00 in Lagos (UTC+1)
const MON = new Date('2026-10-05T12:00:00.000Z');

describe('resolveRange (Lagos, UTC+1)', () => {
  it('TODAY / YESTERDAY are local-midnight to local-midnight', () => {
    const t = resolveRange('TODAY', MON);
    expect([iso(t.start), iso(t.end)]).toEqual([
      '2026-10-04T23:00:00.000Z',
      '2026-10-05T23:00:00.000Z',
    ]);
    const y = resolveRange('YESTERDAY', MON);
    expect([iso(y.start), iso(y.end)]).toEqual([
      '2026-10-03T23:00:00.000Z',
      '2026-10-04T23:00:00.000Z',
    ]);
  });

  it('uses the LOCAL date, not the UTC one, near midnight (23:30 UTC is already tomorrow in Lagos)', () => {
    const late = resolveRange('TODAY', new Date('2026-10-05T23:30:00.000Z'));
    expect(iso(late.start)).toBe('2026-10-05T23:00:00.000Z');
  });

  it('THIS_WEEK starts on Monday by default and on Sunday when configured', () => {
    const wed = new Date('2026-10-07T09:00:00.000Z');
    expect(iso(resolveRange('THIS_WEEK', wed).start)).toBe(
      '2026-10-04T23:00:00.000Z',
    ); // Mon 5 Oct
    expect(iso(resolveRange('THIS_WEEK', wed).end)).toBe(
      '2026-10-11T23:00:00.000Z',
    );
    expect(iso(resolveRange('THIS_WEEK', wed, { weekStartsOn: 0 }).start)).toBe(
      '2026-10-03T23:00:00.000Z',
    ); // Sun 4 Oct
  });

  it('THIS_MONTH, PREVIOUS_MONTH, THIS_QUARTER, THIS_YEAR', () => {
    const m = resolveRange('THIS_MONTH', MON);
    expect([iso(m.start), iso(m.end)]).toEqual([
      '2026-09-30T23:00:00.000Z',
      '2026-10-31T23:00:00.000Z',
    ]);
    const pm = resolveRange('PREVIOUS_MONTH', MON);
    expect([iso(pm.start), iso(pm.end)]).toEqual([
      '2026-08-31T23:00:00.000Z',
      '2026-09-30T23:00:00.000Z',
    ]);
    const q = resolveRange('THIS_QUARTER', MON);
    expect([iso(q.start), iso(q.end)]).toEqual([
      '2026-09-30T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ]);
    const y = resolveRange('THIS_YEAR', MON);
    expect([iso(y.start), iso(y.end)]).toEqual([
      '2025-12-31T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ]);
  });

  it('previous month works across a year boundary', () => {
    const jan = resolveRange(
      'PREVIOUS_MONTH',
      new Date('2027-01-15T10:00:00.000Z'),
    );
    expect([iso(jan.start), iso(jan.end)]).toEqual([
      '2026-11-30T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ]);
  });

  it('the half-open ranges tile with no gap or overlap', () => {
    const a = resolveRange('YESTERDAY', MON);
    const b = resolveRange('TODAY', MON);
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  describe('CUSTOM', () => {
    it('treats `to` as inclusive', () => {
      const r = resolveRange('CUSTOM', MON, {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect([iso(r.start), iso(r.end)]).toEqual([
        '2026-09-30T23:00:00.000Z',
        '2026-10-31T23:00:00.000Z',
      ]);
      expect(r.label).toBe('1 Oct 2026 – 31 Oct 2026');
    });
    it('rejects missing, inverted, impossible and runaway ranges', () => {
      expect(() => resolveRange('CUSTOM', MON, { from: '2026-10-01' })).toThrow(
        PeriodError,
      );
      expect(() =>
        resolveRange('CUSTOM', MON, { from: '2026-10-10', to: '2026-10-01' }),
      ).toThrow(PeriodError);
      expect(() =>
        resolveRange('CUSTOM', MON, { from: '2026-02-30', to: '2026-03-05' }),
      ).toThrow(/real calendar date/);
      expect(() =>
        resolveRange('CUSTOM', MON, { from: '10/01/2026', to: '2026-10-05' }),
      ).toThrow(PeriodError);
      expect(() =>
        resolveRange('CUSTOM', MON, { from: '2015-01-01', to: '2026-01-01' }),
      ).toThrow(/three years/);
    });
  });
});

describe('comparisonRange', () => {
  const month = resolveRange('THIS_MONTH', MON); // 1 Oct – 1 Nov (31 days)

  it('PREVIOUS_PERIOD is the equally long window that ends where this one starts', () => {
    const c = comparisonRange(month, 'PREVIOUS_PERIOD');
    expect(c.end.getTime()).toBe(month.start.getTime());
    expect(c.end.getTime() - c.start.getTime()).toBe(
      month.end.getTime() - month.start.getTime(),
    );
  });

  it('PREVIOUS_MONTH compares the same calendar days of the previous month', () => {
    const c = comparisonRange(month, 'PREVIOUS_MONTH');
    expect([iso(c.start), iso(c.end)]).toEqual([
      '2026-08-31T23:00:00.000Z',
      '2026-09-30T23:00:00.000Z',
    ]);
  });

  it('PREVIOUS_QUARTER and PREVIOUS_YEAR shift by 3 and 12 months', () => {
    expect(iso(comparisonRange(month, 'PREVIOUS_QUARTER').start)).toBe(
      '2026-06-30T23:00:00.000Z',
    ); // 1 Jul 2026
    const year = resolveRange('THIS_YEAR', MON);
    const py = comparisonRange(year, 'PREVIOUS_YEAR');
    expect([iso(py.start), iso(py.end)]).toEqual([
      '2024-12-31T23:00:00.000Z',
      '2025-12-31T23:00:00.000Z',
    ]);
  });

  it('clamps to the end of a shorter month (31 Mar -> 28 Feb)', () => {
    const range = resolveRange('CUSTOM', MON, {
      from: '2027-03-31',
      to: '2027-03-31',
    });
    const c = comparisonRange(range, 'PREVIOUS_MONTH');
    expect(iso(c.start)).toBe('2027-02-27T23:00:00.000Z'); // 28 Feb 2027, local midnight
  });
});

describe('compareValues — never fakes a comparison', () => {
  it('computes change and percentage', () => {
    expect(compareValues(120, 100)).toMatchObject({
      change: 20,
      changePercent: 20,
      direction: 'UP',
      status: 'OK',
    });
    expect(compareValues(80, 100)).toMatchObject({
      change: -20,
      changePercent: -20,
      direction: 'DOWN',
    });
    expect(compareValues(100, 100)).toMatchObject({
      change: 0,
      changePercent: 0,
      direction: 'FLAT',
    });
  });
  it('rounds the percentage to two decimals', () => {
    expect(compareValues(1, 3).changePercent).toBe(-66.67);
  });
  it('shows NO percentage against a zero baseline (no invented "+100%")', () => {
    const c = compareValues(500, 0);
    expect(c.changePercent).toBeNull();
    expect(c.change).toBe(500);
    expect(c.note).toContain('zero baseline');
  });
  it('reports NO_BASELINE when there is no previous figure at all', () => {
    expect(compareValues(500, null)).toMatchObject({
      status: 'NO_BASELINE',
      change: null,
      changePercent: null,
      direction: null,
    });
  });
  it('reports INSUFFICIENT_DATA when the previous window has no records', () => {
    expect(compareValues(500, 0, false)).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      changePercent: null,
    });
  });
  it('a window that predates our data is INSUFFICIENT_DATA even when the baseline figure is also null', () => {
    expect(compareValues(500, null, false)).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      previous: null,
      changePercent: null,
    });
  });
  it('handles a negative baseline sensibly', () => {
    expect(compareValues(-50, -100).changePercent).toBe(50);
  });
});

describe('receivables ageing buckets (configurable)', () => {
  it('default thresholds give current / 1-30 / 31-60 / 61-90 / over 90', () => {
    const b = buildAgeingBuckets();
    expect(b.map((x) => x.label)).toEqual([
      'Current (not yet due)',
      '1–30 days',
      '31–60 days',
      '61–90 days',
      'Over 90 days',
    ]);
  });
  it('places every number of days in exactly one bucket, with correct edges', () => {
    const b = buildAgeingBuckets();
    const key = (d: number) => bucketFor(d, b).key;
    expect([
      key(-20),
      key(0),
      key(1),
      key(30),
      key(31),
      key(60),
      key(61),
      key(90),
      key(91),
      key(900),
    ]).toEqual([
      'CURRENT',
      'CURRENT',
      'D1_30',
      'D1_30',
      'D31_60',
      'D31_60',
      'D61_90',
      'D61_90',
      'D91_PLUS',
      'D91_PLUS',
    ]);
  });
  it('thresholds are configurable and order-insensitive', () => {
    const b = buildAgeingBuckets([45, 15]);
    expect(b.map((x) => x.key)).toEqual([
      'CURRENT',
      'D1_15',
      'D16_45',
      'D46_PLUS',
    ]);
    expect(bucketFor(20, b).key).toBe('D16_45');
  });
  it('rejects non-positive, fractional or duplicate thresholds', () => {
    for (const bad of [[0], [-5], [1.5], [30, 30]]) {
      expect(() => buildAgeingBuckets(bad)).toThrow(PeriodError);
    }
  });
  it('daysOverdue counts whole days past the due date', () => {
    const due = new Date('2026-10-01T00:00:00.000Z');
    expect(daysOverdue(due, new Date('2026-10-11T12:00:00.000Z'))).toBe(10);
    expect(daysOverdue(due, new Date('2026-09-25T00:00:00.000Z'))).toBeLessThan(
      0,
    );
  });
});

describe('comparisonRangeToDate — like-for-like while a period is still running', () => {
  const NOW = new Date('2026-10-06T11:00:00.000Z'); // 6 Oct, ~5 days into October (Lagos 12:00)

  it('cuts the comparison to the same elapsed time instead of the whole previous month', () => {
    const month = resolveRange('THIS_MONTH', NOW);
    const r = comparisonRangeToDate(month, 'PREVIOUS_MONTH', NOW);
    expect(r?.inProgress).toBe(true);
    const elapsed = NOW.getTime() - month.start.getTime();
    expect(r!.range.end.getTime() - r!.range.start.getTime()).toBe(elapsed);
    expect(r!.range.start.toISOString()).toBe('2026-08-31T23:00:00.000Z'); // starts 1 Sep local
    expect(r!.range.label).toBe(
      'Same period, previous month, same elapsed time',
    );
  });

  it('labels PREVIOUS_PERIOD with the dates actually compared, not the whole earlier period', () => {
    const month = resolveRange('THIS_MONTH', NOW);
    const r = comparisonRangeToDate(month, 'PREVIOUS_PERIOD', NOW)!;
    // 31 days before 1 Oct is 31 Aug; only the first 5.5 days of it are compared.
    expect(r.range.label).toBe(
      'Previous period, same elapsed time (31 Aug 2026 – 5 Sep 2026)',
    );
  });

  it('PREVIOUS_PERIOD for a running day compares with the FIRST hours of the previous day, not the hours just before', () => {
    const today = resolveRange('TODAY', NOW);
    const r = comparisonRangeToDate(today, 'PREVIOUS_PERIOD', NOW)!;
    expect(r.range.start.toISOString()).toBe('2026-10-04T23:00:00.000Z'); // yesterday 00:00 local
    expect(r.range.end.toISOString()).toBe('2026-10-05T11:00:00.000Z'); // same 12 elapsed hours
  });

  it('a finished period is compared in full', () => {
    const last = resolveRange('PREVIOUS_MONTH', NOW);
    const r = comparisonRangeToDate(last, 'PREVIOUS_MONTH', NOW)!;
    expect(r.inProgress).toBe(false);
    expect(r.range).toEqual(comparisonRange(last, 'PREVIOUS_MONTH'));
  });

  it('returns null for a period that has not started (nothing to compare)', () => {
    const future = resolveRange('CUSTOM', NOW, {
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(comparisonRangeToDate(future, 'PREVIOUS_PERIOD', NOW)).toBeNull();
  });
});
