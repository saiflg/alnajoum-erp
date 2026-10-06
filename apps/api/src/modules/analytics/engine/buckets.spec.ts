import {
  bucketKeys,
  defaultGranularity,
  fillBuckets,
  MAX_POINTS,
} from './buckets';
import { resolveRange } from './periods';

const NOW = new Date('2026-10-05T12:00:00.000Z'); // Monday

describe('bucketKeys (Lagos)', () => {
  it('lists every day of a month, including quiet ones', () => {
    const keys = bucketKeys(resolveRange('PREVIOUS_MONTH', NOW), 'day');
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe('2026-09-01');
    expect(keys[29]).toBe('2026-09-30');
  });

  it('weeks are keyed by their Monday and the first one may start before the range', () => {
    const keys = bucketKeys(resolveRange('THIS_MONTH', NOW), 'week'); // 1 Oct (Thu) .. 31 Oct
    expect(keys[0]).toBe('2026-09-28');
    expect(keys[keys.length - 1]).toBe('2026-10-26');
    expect(keys).toHaveLength(5);
  });

  it('months span a year boundary', () => {
    const range = resolveRange('CUSTOM', NOW, {
      from: '2026-11-15',
      to: '2027-02-10',
    });
    expect(bucketKeys(range, 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });

  it('a single day is one bucket', () => {
    expect(bucketKeys(resolveRange('TODAY', NOW), 'day')).toEqual([
      '2026-10-05',
    ]);
  });

  it('picks a readable granularity', () => {
    expect(defaultGranularity(resolveRange('THIS_MONTH', NOW))).toBe('day');
    expect(defaultGranularity(resolveRange('THIS_QUARTER', NOW))).toBe('week');
    expect(
      defaultGranularity(
        resolveRange('CUSTOM', NOW, { from: '2024-01-01', to: '2026-01-01' }),
      ),
    ).toBe('month');
  });

  it('the default granularity never exceeds the point cap for a legal range', () => {
    for (const r of [
      resolveRange('THIS_YEAR', NOW),
      resolveRange('CUSTOM', NOW, { from: '2024-01-01', to: '2026-12-31' }),
      resolveRange('CUSTOM', NOW, { from: '2026-01-01', to: '2026-03-01' }),
    ]) {
      expect(bucketKeys(r, defaultGranularity(r)).length).toBeLessThanOrEqual(
        MAX_POINTS,
      );
    }
  });
});

describe('fillBuckets', () => {
  it('shows empty periods as an honest zero and ignores rows outside the key list', () => {
    expect(
      fillBuckets(
        ['a', 'b', 'c'],
        [
          { key: 'b', value: 7 },
          { key: 'z', value: 99 },
        ],
      ),
    ).toEqual([
      { key: 'a', value: 0 },
      { key: 'b', value: 7 },
      { key: 'c', value: 0 },
    ]);
  });
});
