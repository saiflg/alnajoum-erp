import { StaffIdCardStatus } from '@prisma/client';
import {
  addMonths,
  canApply,
  CardAction,
  daysBetween,
  effectiveStatus,
  isPlausibleToken,
  LIVE_STATUSES,
  newCardNumber,
  newVerificationToken,
  normaliseCardNumber,
  REASON_REQUIRED,
  toVerificationResult,
  VERIFICATION_LABELS,
} from './staff-card.policy';

const ALL: StaffIdCardStatus[] = [
  'PENDING',
  'ACTIVE',
  'EXPIRED',
  'SUSPENDED',
  'REVOKED',
  'REPLACED',
];
const NOW = new Date('2026-10-13T12:00:00.000Z');
const past = new Date('2026-10-01T00:00:00.000Z');
const future = new Date('2027-10-01T00:00:00.000Z');

describe('card lifecycle rules', () => {
  const allowed: Record<CardAction, StaffIdCardStatus[]> = {
    ACTIVATE: ['PENDING'],
    RENEW: ['ACTIVE', 'EXPIRED'],
    SUSPEND: ['ACTIVE'],
    REINSTATE: ['SUSPENDED'],
    REVOKE: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
    REPLACE: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
  };

  it.each(Object.keys(allowed) as CardAction[])(
    '%s is possible from exactly the documented states',
    (action) => {
      for (const status of ALL) {
        expect(canApply(action, status)).toBe(allowed[action].includes(status));
      }
    },
  );

  it('a revoked or replaced card can never be brought back', () => {
    for (const action of [
      'ACTIVATE',
      'RENEW',
      'SUSPEND',
      'REINSTATE',
      'REVOKE',
      'REPLACE',
    ] as CardAction[]) {
      expect(canApply(action, 'REVOKED')).toBe(false);
      expect(canApply(action, 'REPLACED')).toBe(false);
    }
  });

  it('actions that remove or override a control need a reason', () => {
    expect([...REASON_REQUIRED].sort()).toEqual(
      ['REINSTATE', 'REPLACE', 'REVOKE', 'SUSPEND'].sort(),
    );
  });

  it('only an in-use card counts as the staff member current card', () => {
    expect([...LIVE_STATUSES].sort()).toEqual(
      ['ACTIVE', 'EXPIRED', 'PENDING', 'SUSPENDED'].sort(),
    );
  });
});

describe('effectiveStatus', () => {
  it('reports an ACTIVE card past its expiry as EXPIRED before any sweep has run', () => {
    expect(
      effectiveStatus({ status: 'ACTIVE', expiresAt: past }, true, NOW),
    ).toBe('EXPIRED');
  });

  it('keeps an in-date ACTIVE card ACTIVE, and one with no expiry too', () => {
    expect(
      effectiveStatus({ status: 'ACTIVE', expiresAt: future }, true, NOW),
    ).toBe('ACTIVE');
    expect(
      effectiveStatus({ status: 'ACTIVE', expiresAt: null }, true, NOW),
    ).toBe('ACTIVE');
  });

  it('treats the expiry instant itself as expired', () => {
    expect(
      effectiveStatus({ status: 'ACTIVE', expiresAt: NOW }, true, NOW),
    ).toBe('EXPIRED');
  });

  it('a deactivated staff member card stops being valid whatever its stored state', () => {
    expect(
      effectiveStatus({ status: 'ACTIVE', expiresAt: future }, false, NOW),
    ).toBe('REVOKED');
    expect(
      effectiveStatus({ status: 'SUSPENDED', expiresAt: future }, false, NOW),
    ).toBe('REVOKED');
  });

  it('does not change terminal or pending states', () => {
    for (const status of ['REVOKED', 'REPLACED', 'PENDING'] as const) {
      expect(effectiveStatus({ status, expiresAt: past }, true, NOW)).toBe(
        status,
      );
    }
  });
});

describe('verification results', () => {
  it('maps every stored status to exactly one of the six results', () => {
    expect(ALL.map(toVerificationResult)).toEqual([
      'INVALID', // PENDING: not handed over yet
      'VALID',
      'EXPIRED',
      'SUSPENDED',
      'REVOKED',
      'REPLACED',
    ]);
  });

  it('uses the wording the brief asks for', () => {
    expect(VERIFICATION_LABELS).toEqual({
      VALID: 'VALID — ACTIVE CARD',
      EXPIRED: 'EXPIRED — CARD EXPIRED',
      SUSPENDED: 'SUSPENDED — CARD SUSPENDED',
      REVOKED: 'REVOKED — CARD REVOKED',
      REPLACED: 'REPLACED — OLD CARD REPLACED',
      INVALID: 'INVALID — CARD NOT RECOGNIZED',
    });
  });
});

describe('identifiers', () => {
  it('verification tokens are 22 url-safe characters and effectively never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = newVerificationToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isPlausibleToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });

  it.each([
    '',
    'short',
    'a'.repeat(21),
    'a'.repeat(23),
    'ALN-C-7K3Q-9M2X',
    "' OR 1=1 --aaaaaaaaaaaa",
    '../../etc/passwd/aaaaaa',
    'abcdefghijklmnopqrstu!',
  ])(
    'rejects the implausible token %p before it reaches the database',
    (bad) => {
      expect(isPlausibleToken(bad)).toBe(false);
    },
  );

  it('rejects non-strings', () => {
    expect(isPlausibleToken(undefined)).toBe(false);
    expect(isPlausibleToken(1234567890123456)).toBe(false);
    expect(isPlausibleToken({ a: 1 })).toBe(false);
  });

  it('card numbers are readable, avoid look-alike characters, and are not sequential', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = newCardNumber();
      expect(n).toMatch(/^ALN-C-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(495);
  });

  it('a hand-typed reference is normalised before lookup', () => {
    expect(normaliseCardNumber('  aln-c-7k3q-9m2x ')).toBe('ALN-C-7K3Q-9M2X');
    expect(normaliseCardNumber('ALN C 7K3Q 9M2X')).toBe('ALN-C-7K3Q-9M2X');
    expect(normaliseCardNumber('ALN–C–7K3Q–9M2X')).toBe('ALN-C-7K3Q-9M2X');
  });
});

describe('dates', () => {
  it('adds calendar months and clamps the day instead of rolling over', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addMonths(new Date('2026-10-13T00:00:00Z'), 24).toISOString()).toBe(
      '2028-10-13T00:00:00.000Z',
    );
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('counts whole days remaining, rounding up', () => {
    expect(daysBetween(NOW, new Date(NOW.getTime() + 30 * 86_400_000))).toBe(
      30,
    );
    expect(daysBetween(NOW, new Date(NOW.getTime() + 3600_000))).toBe(1);
    expect(daysBetween(NOW, new Date(NOW.getTime() - 86_400_000))).toBe(-1);
  });
});
