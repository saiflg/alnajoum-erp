import {
  isPlausiblePhoneNumber,
  normalizePhoneNumber,
} from './phone-number.util';

describe('normalizePhoneNumber', () => {
  it('passes through an already-international number unchanged (with +)', () => {
    expect(normalizePhoneNumber('+2348031234567')).toBe('+2348031234567');
  });

  it('adds + to a number with a 00 international prefix', () => {
    expect(normalizePhoneNumber('002348031234567')).toBe('+2348031234567');
  });

  it('converts a local Nigerian number (leading 0) using the default country code', () => {
    expect(normalizePhoneNumber('08031234567')).toBe('+2348031234567');
  });

  it('respects a different default country code for a local number', () => {
    expect(normalizePhoneNumber('07911123456', '44')).toBe('+447911123456');
  });

  it('adds + to digits that already start with the default country code', () => {
    expect(normalizePhoneNumber('2348031234567')).toBe('+2348031234567');
  });

  it('strips non-digit formatting characters (spaces, dashes, parens)', () => {
    expect(normalizePhoneNumber('+234 803 123-4567')).toBe('+2348031234567');
  });

  it('is idempotent — normalizing an already-normalized number is a no-op', () => {
    const once = normalizePhoneNumber('08031234567');
    expect(normalizePhoneNumber(once)).toBe(once);
  });
});

describe('isPlausiblePhoneNumber', () => {
  it('accepts a well-formed E.164 number', () => {
    expect(isPlausiblePhoneNumber('+2348031234567')).toBe(true);
  });

  it('rejects a number with no country code prefix', () => {
    expect(isPlausiblePhoneNumber('08031234567')).toBe(false);
  });

  it('rejects obviously non-numeric garbage', () => {
    expect(isPlausiblePhoneNumber('+abc')).toBe(false);
  });

  it('rejects an implausibly short number', () => {
    expect(isPlausiblePhoneNumber('+123')).toBe(false);
  });
});
