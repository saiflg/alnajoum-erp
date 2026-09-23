/**
 * Phase 14 spec #6 — normalizes a phone number to E.164 (the format
 * WhatsApp's wa_id uses) before it's ever used as a lookup key, so
 * "0803...", "+234803...", and "234803..." all resolve to the same
 * conversation/customer instead of silently creating three. Deliberately
 * simple (no external phone-number library) — good enough for WhatsApp's
 * own numbering (it never sends anything but digits, optionally
 * prefixed), not a general-purpose phone validator.
 *
 * `defaultCountryCode` (e.g. "234" for Nigeria) is used only for a
 * number entered locally (leading 0, no country code) — an already
 * international number is never reinterpreted through it, so the
 * architecture works for any country, not just Nigeria (spec #6's "the
 * architecture must work internationally").
 */
export function normalizePhoneNumber(
  raw: string,
  defaultCountryCode = '234',
): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.trim().startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith('0')) {
    return `+${defaultCountryCode}${digits.slice(1)}`;
  }
  if (digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  // Already looks international (longer than a typical local number,
  // doesn't start with the trunk-prefix 0) — trust it as-is.
  return `+${digits}`;
}

/** Loose validity check — enough to reject obvious garbage input before it
 * reaches a provider API call, not a full ITU E.164 validator. */
export function isPlausiblePhoneNumber(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}
