import { randomBytes } from 'node:crypto';
import {
  isPlausiblePhoneNumber,
  normalizePhoneNumber,
} from '../whatsapp/phone-number.util';

/** Lower-case, trimmed address, or null when it is not plausibly an email address. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.length < 5 || v.length > 254) return null;
  // Deliberately simple: one @, a dot in the domain, no whitespace or angle brackets. The provider has the last word.
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\],;:"]+\.[a-z0-9-]{2,}$/i.test(v))
    return null;
  return v;
}

/** E.164 number, or null when the input is not plausibly a phone number. */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountryCode = '234',
): string | null {
  const v = (raw ?? '').trim();
  if (!v || !/\d/.test(v)) return null;
  if (/[a-z]/i.test(v)) return null;
  const e164 = normalizePhoneNumber(v, defaultCountryCode);
  return isPlausiblePhoneNumber(e164) ? e164 : null;
}

/** +234*****678 */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return '*'.repeat(e164.length);
  return `${e164.slice(0, 4)}${'*'.repeat(e164.length - 7)}${e164.slice(-3)}`;
}

/** a***@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Opaque, unguessable value (128 bits) for preference and unsubscribe links. */
export function newOpaqueToken(): string {
  return randomBytes(16).toString('base64url');
}

export const CONTACT_INTERESTS = [
  'FLIGHT',
  'HOTEL',
  'VISA',
  'HAJJ',
  'UMRAH',
  'CORPORATE',
] as const;
export const CONTACT_LANGUAGES = ['en', 'ha', 'ar'] as const;

export function normaliseTags(tags: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const t of tags ?? []) {
    const v = t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    if (v) out.add(v);
  }
  return [...out].slice(0, 30);
}
