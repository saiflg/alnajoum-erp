import { isSensitiveKey, jsonSize, redact, REDACTED } from './redact';

describe('redact', () => {
  it('replaces sensitive values anywhere in the tree, by key name', () => {
    const out = redact({
      customer: {
        name: 'Amina',
        password: 'hunter2',
        passportNumber: 'A1234567',
        nested: { apiKey: 'sk_live_x', refreshToken: 'abc' },
      },
      payment: { cardNumber: '4111111111111111', cvv: '123', amount: 5000 },
      otp: '123456',
      list: [{ secret: 's' }, { ok: 1 }],
    });
    expect(out).toEqual({
      customer: {
        name: 'Amina',
        password: REDACTED,
        passportNumber: REDACTED,
        nested: { apiKey: REDACTED, refreshToken: REDACTED },
      },
      payment: { cardNumber: REDACTED, cvv: REDACTED, amount: 5000 },
      otp: REDACTED,
      list: [{ secret: REDACTED }, { ok: 1 }],
    });
  });
  it('does not mutate its input', () => {
    const input = { password: 'x', a: { token: 'y' } };
    redact(input);
    expect(input).toEqual({ password: 'x', a: { token: 'y' } });
  });
  it('leaves ordinary fields alone (including look-alikes)', () => {
    for (const k of [
      'name',
      'bookingReference',
      'amount',
      'currency',
      'departureAt',
      'status',
      'passengerCount',
      'description',
    ]) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
  it('catches the common spellings', () => {
    for (const k of [
      'password',
      'Password',
      'passwordHash',
      'new_password',
      'accessToken',
      'access_token',
      'clientSecret',
      'authorization',
      'x-api-key',
      'privateKey',
      'passport_number',
      'accountNumber',
      'cardNumber',
      'CVV',
      'otp',
      'pin',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('keeps dates and caps depth and list length', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(redact({ at: d }).at).toBe(d);
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { n: deep };
    expect(JSON.stringify(redact(deep))).toContain(REDACTED);
    expect(redact(Array.from({ length: 500 }, (_, i) => i))).toHaveLength(200);
  });
  it('jsonSize measures bytes, not characters', () => {
    expect(jsonSize('a')).toBe(3);
    expect(jsonSize('é')).toBe(4);
    expect(jsonSize(undefined)).toBe(4);
  });
});
