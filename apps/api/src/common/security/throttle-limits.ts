/**
 * Per-route request limits for the unauthenticated credential endpoints (Phase 22 S-19). The global
 * default (100 requests/minute per client) is far too generous for login, registration, password
 * reset and 2FA verification, which is where guessing and enumeration happen.
 *
 * `AUTH_THROTTLE_LIMIT` exists so automated end-to-end suites, which log in many times from one
 * address, can raise it; it is not a production tuning knob and the production gate warns if it is set.
 */
const parsed = Number(process.env.AUTH_THROTTLE_LIMIT);
const AUTH_LIMIT = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;

/** login, register, forgot/reset password, 2FA verification. */
export const CREDENTIAL_THROTTLE = {
  default: { ttl: 60_000, limit: AUTH_LIMIT },
} as const;

/** Refresh is called silently and often by the web app, so it is limited more loosely. */
export const REFRESH_THROTTLE = {
  default: { ttl: 60_000, limit: Math.max(AUTH_LIMIT * 6, 60) },
} as const;
