/**
 * Phase 21 — keep secrets and sensitive identifiers out of stored events and traces.
 *
 * Events and execution contexts are persisted and shown in the admin UI, so a
 * payload must never carry a password, token, OTP, card number or identity-document
 * number. Matching is by KEY NAME (deep), and the value is replaced, never partially
 * shown. This is a safety net on top of "do not put them in the event in the first
 * place"; publishers should still send ids, not documents.
 */

const SENSITIVE_KEY =
  /password|passcode|passphrase|^pass$|^pwd$|secret|token|otp|pin$|cvv|cvc|card(number|_number)?$|^pan$|authorization|api[_-]?key|private[_-]?key|passport(number|_number|no)?$|national[_-]?id|bvn|nin$|account(number|_number)$|iban|ssn/i;

export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (Array.isArray(value))
    return (value as unknown[])
      .slice(0, 200)
      .map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Serialised size in bytes (UTF-8), used to cap what an event or step output may store. */
export function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
