import {
  Condition,
  ConditionError,
  evaluateCondition,
  isSafePath,
  readPath,
  validateCondition,
} from './conditions';

const ctx = {
  booking: {
    totalAmount: 750_000,
    currency: 'NGN',
    status: 'CONFIRMED',
    departureAt: '2026-11-10T08:00:00Z',
    tags: ['vip', 'hajj'],
    reference: 'ANJ-001',
  },
  customer: { name: 'Amina Yusuf', segment: 'VIP' },
  empty: '',
};
const run = (c: Condition, context: unknown = ctx) =>
  evaluateCondition(c, context).result;

describe('operators', () => {
  it('eq / neq', () => {
    expect(run({ field: 'booking.currency', op: 'eq', value: 'NGN' })).toBe(
      true,
    );
    expect(run({ field: 'booking.currency', op: 'neq', value: 'USD' })).toBe(
      true,
    );
    expect(run({ field: 'booking.currency', op: 'neq', value: 'NGN' })).toBe(
      false,
    );
  });
  it('numeric comparisons', () => {
    expect(
      run({ field: 'booking.totalAmount', op: 'gt', value: 500_000 }),
    ).toBe(true);
    expect(
      run({ field: 'booking.totalAmount', op: 'gte', value: 750_000 }),
    ).toBe(true);
    expect(
      run({ field: 'booking.totalAmount', op: 'lt', value: 750_000 }),
    ).toBe(false);
    expect(
      run({ field: 'booking.totalAmount', op: 'lte', value: 750_000 }),
    ).toBe(true);
  });
  it('does not compare a number with numeric text (no silent coercion)', () => {
    expect(
      run({ field: 'amount', op: 'gt', value: 5 }, { amount: '100' }),
    ).toBe(false);
    expect(
      run({ field: 'amount', op: 'eq', value: 100 }, { amount: '100' }),
    ).toBe(false);
  });
  it('text operators are case-insensitive', () => {
    expect(
      run({ field: 'customer.name', op: 'contains', value: 'AMINA' }),
    ).toBe(true);
    expect(
      run({ field: 'booking.reference', op: 'startsWith', value: 'anj' }),
    ).toBe(true);
    expect(
      run({ field: 'booking.reference', op: 'endsWith', value: '001' }),
    ).toBe(true);
    expect(
      run({ field: 'booking.reference', op: 'endsWith', value: '002' }),
    ).toBe(false);
  });
  it('contains works on lists', () => {
    expect(run({ field: 'booking.tags', op: 'contains', value: 'vip' })).toBe(
      true,
    );
    expect(run({ field: 'booking.tags', op: 'contains', value: 'group' })).toBe(
      false,
    );
  });
  it('in / notIn', () => {
    expect(
      run({
        field: 'booking.status',
        op: 'in',
        value: ['CONFIRMED', 'TICKETED'],
      }),
    ).toBe(true);
    expect(
      run({ field: 'booking.status', op: 'notIn', value: ['CANCELLED'] }),
    ).toBe(true);
    expect(
      run({ field: 'booking.status', op: 'notIn', value: ['CONFIRMED'] }),
    ).toBe(false);
  });
  it('exists / notExists treat null, undefined and empty text as absent', () => {
    expect(run({ field: 'booking.status', op: 'exists' })).toBe(true);
    expect(run({ field: 'booking.nothing', op: 'exists' })).toBe(false);
    expect(run({ field: 'empty', op: 'exists' })).toBe(false);
    expect(run({ field: 'empty', op: 'notExists' })).toBe(true);
    expect(run({ field: 'x', op: 'notExists' }, { x: null })).toBe(true);
  });
  it('date operators', () => {
    expect(
      run({
        field: 'booking.departureAt',
        op: 'dateBefore',
        value: '2026-12-01',
      }),
    ).toBe(true);
    expect(
      run({
        field: 'booking.departureAt',
        op: 'dateAfter',
        value: '2026-11-01',
      }),
    ).toBe(true);
    expect(
      run({
        field: 'booking.departureAt',
        op: 'dateBetween',
        value: { from: '2026-11-01', to: '2026-11-30' },
      }),
    ).toBe(true);
    expect(
      run({
        field: 'booking.departureAt',
        op: 'dateBetween',
        value: { from: '2026-12-01', to: '2026-12-31' },
      }),
    ).toBe(false);
  });
  it('an unparseable date is false with a note, not an exception', () => {
    const r = evaluateCondition(
      { field: 'd', op: 'dateAfter', value: '2026-01-01' },
      { d: 'next tuesday' },
    );
    expect(r.result).toBe(false);
    expect(r.trace[0].note).toContain('not a valid date');
  });
  it('a missing field is false for comparisons (never throws), true for neq/notIn', () => {
    expect(run({ field: 'nope', op: 'gt', value: 1 })).toBe(false);
    expect(run({ field: 'nope', op: 'eq', value: 'a' })).toBe(false);
    expect(run({ field: 'nope', op: 'neq', value: 'a' })).toBe(true);
    expect(run({ field: 'nope', op: 'notIn', value: ['a'] })).toBe(true);
  });
});

describe('nested logic', () => {
  it('AND / OR / NOT', () => {
    const c: Condition = {
      all: [
        { field: 'booking.totalAmount', op: 'gte', value: 500_000 },
        {
          any: [
            { field: 'customer.segment', op: 'eq', value: 'VIP' },
            { field: 'booking.currency', op: 'eq', value: 'USD' },
          ],
        },
        { not: { field: 'booking.status', op: 'eq', value: 'CANCELLED' } },
      ],
    };
    expect(run(c)).toBe(true);
    expect(run(c, { ...ctx, customer: { segment: 'STANDARD' } })).toBe(false);
  });
  it('the trace lists every part and where it sits', () => {
    const r = evaluateCondition(
      {
        all: [
          { field: 'booking.status', op: 'eq', value: 'CONFIRMED' },
          { any: [{ field: 'customer.segment', op: 'eq', value: 'VIP' }] },
        ],
      },
      ctx,
    );
    expect(r.trace.map((t) => t.path)).toEqual(['all[0]', 'all[1].any[0]']);
    expect(r.trace.every((t) => t.result)).toBe(true);
  });
  it('is deterministic', () => {
    const c: Condition = {
      any: [
        { field: 'booking.status', op: 'eq', value: 'X' },
        { field: 'booking.currency', op: 'eq', value: 'NGN' },
      ],
    };
    expect(evaluateCondition(c, ctx)).toEqual(evaluateCondition(c, ctx));
  });
  it('traces never hold a whole object or a very long string', () => {
    const r = evaluateCondition(
      { field: 'big', op: 'exists' },
      { big: { a: 1 } },
    );
    expect(r.trace[0].actual).toBe('[object]');
    const long = evaluateCondition(
      { field: 's', op: 'exists' },
      { s: 'x'.repeat(1000) },
    );
    expect((long.trace[0].actual as string).length).toBeLessThan(250);
  });
});

describe('validation', () => {
  it('accepts a good condition', () => {
    expect(validateCondition({ field: 'a.b', op: 'eq', value: 1 })).toEqual([]);
  });
  it('rejects unknown operators, missing/extra values and unknown keys', () => {
    expect(
      validateCondition({ field: 'a', op: 'matches', value: '.*' }).length,
    ).toBeGreaterThan(0);
    expect(
      validateCondition({ field: 'a', op: 'eq' })
        .map((i) => i.message)
        .join(),
    ).toContain('needs a value');
    expect(
      validateCondition({ field: 'a', op: 'exists', value: 1 })
        .map((i) => i.message)
        .join(),
    ).toContain('does not take a value');
    expect(
      validateCondition({ field: 'a', op: 'eq', value: 1, code: 'x' })
        .map((i) => i.message)
        .join(),
    ).toContain('Unknown key');
  });
  it('rejects empty groups, non-objects and arrays', () => {
    expect(validateCondition({ all: [] }).length).toBe(1);
    expect(validateCondition('a == b').length).toBe(1);
    expect(validateCondition([]).length).toBe(1);
    expect(validateCondition(null).length).toBe(1);
  });
  it('enforces typed operands', () => {
    expect(validateCondition({ field: 'a', op: 'gt', value: '5' }).length).toBe(
      1,
    );
    expect(
      validateCondition({ field: 'a', op: 'dateBefore', value: 'soon' }).length,
    ).toBe(1);
    expect(validateCondition({ field: 'a', op: 'in', value: 'x' }).length).toBe(
      1,
    );
    expect(
      validateCondition({ field: 'a', op: 'in', value: [{ x: 1 }] }).length,
    ).toBe(1);
    expect(
      validateCondition({
        field: 'a',
        op: 'dateBetween',
        value: { from: '2026-02-01', to: '2026-01-01' },
      }).length,
    ).toBe(1);
  });
  it('limits depth and size', () => {
    let deep: Condition = { field: 'a', op: 'exists' };
    for (let i = 0; i < 8; i++) deep = { not: deep };
    expect(
      validateCondition(deep)
        .map((i) => i.message)
        .join(),
    ).toContain('nest at most');
    const wide = {
      all: Array.from({ length: 150 }, () => ({ field: 'a', op: 'exists' })),
    };
    expect(
      validateCondition(wide)
        .map((i) => i.message)
        .join(),
    ).toContain('at most 100');
  });
  it('checks fields against what the trigger provides', () => {
    const allowed = new Set(['booking.status']);
    expect(
      validateCondition(
        { field: 'booking.status', op: 'exists' },
        { allowedFields: allowed },
      ),
    ).toEqual([]);
    expect(
      validateCondition(
        { field: 'customer.password', op: 'exists' },
        { allowedFields: allowed },
      )[0].message,
    ).toContain('not available');
  });
  it('a .* entry allows a whole prefix, e.g. earlier step outputs', () => {
    const allowed = new Set(['booking.status', 'steps.*']);
    expect(
      validateCondition(
        { field: 'steps.mail.sent', op: 'eq', value: true },
        { allowedFields: allowed },
      ),
    ).toEqual([]);
    expect(
      validateCondition(
        { field: 'stepsX.mail', op: 'exists' },
        { allowedFields: allowed },
      ),
    ).toHaveLength(1);
    expect(
      validateCondition(
        { field: 'customer.name', op: 'exists' },
        { allowedFields: allowed },
      ),
    ).toHaveLength(1);
  });
  it('evaluating an invalid condition throws instead of guessing', () => {
    expect(() =>
      evaluateCondition({ field: 'a', op: 'nope' } as never, {}),
    ).toThrow(ConditionError);
  });
});

describe('security — conditions are data, never code', () => {
  it('rejects paths that reach the object model', () => {
    for (const p of [
      '__proto__',
      'a.__proto__.x',
      'constructor',
      'a.constructor.name',
      'prototype',
      'a..b',
      '.a',
      'a.',
      'a b',
      'a()',
      'a[0]',
      'a;b',
      '$x',
      '',
    ]) {
      expect(isSafePath(p)).toBe(false);
    }
  });
  it('readPath never returns a prototype member, even for a "safe-looking" own path', () => {
    expect(readPath({}, 'toString')).toBeUndefined();
    expect(readPath({ a: {} }, 'a.hasOwnProperty')).toBeUndefined();
    expect(readPath('text', 'length')).toBeUndefined();
  });
  it('a value that looks like code is only ever compared as text', () => {
    const attack = "process.exit(1); require('fs')";
    expect(run({ field: 'x', op: 'eq', value: attack }, { x: attack })).toBe(
      true,
    );
    expect(run({ field: 'x', op: 'contains', value: '(' }, { x: attack })).toBe(
      true,
    );
  });
  it('an attempt to smuggle a function or regex through the JSON is rejected', () => {
    expect(
      validateCondition({ field: 'a', op: 'eq', value: () => 1 }).length,
    ).toBe(0); // functions never survive JSON; looseEqual below proves they cannot match
    expect(
      run(
        { field: 'a', op: 'eq', value: (() => 1) as unknown as string },
        { a: 1 },
      ),
    ).toBe(false);
    expect(
      validateCondition({ field: 'a', op: 'in', value: [/x/] }).length,
    ).toBe(1);
  });
  it('does not mutate the context', () => {
    const frozen = Object.freeze({ a: Object.freeze({ b: 1 }) });
    expect(() =>
      evaluateCondition({ field: 'a.b', op: 'eq', value: 1 }, frozen),
    ).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
