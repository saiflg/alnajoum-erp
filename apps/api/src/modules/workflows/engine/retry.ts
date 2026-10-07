/**
 * Phase 21 — retry policy.
 *
 * Failures are classified RETRYABLE (a timeout, a provider briefly down) or
 * PERMANENT (invalid input, a refused request). Only retryable failures are
 * retried, with exponential backoff and a hard attempt cap, and an action with a
 * FINANCIAL side effect (payment, refund, payout, supplier booking) is NEVER
 * retried automatically: repeating a money movement on a guess is how duplicate
 * charges happen. A human retries it from the dead-letter queue, and the
 * action's idempotency key still protects against a double execution then.
 */

export type ErrorClass = 'RETRYABLE' | 'PERMANENT';
export type SideEffect = 'NONE' | 'NOTIFY' | 'FINANCIAL';

export class ActionError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorClass,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface RetryPolicy {
  maxAttempts: number; // total tries including the first
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 30_000,
  factor: 2,
  maxDelayMs: 15 * 60_000,
};

export const RETRY_LIMITS = {
  maxAttempts: 10,
  minDelayMs: 100,
  maxDelayMs: 24 * 60 * 60_000,
  maxFactor: 5,
} as const;

export function validateRetryPolicy(p: unknown): string[] {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return ['A retry policy must be an object'];
  const r = p as Record<string, unknown>;
  const int = (k: string, min: number, max: number) => {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      errors.push(`${k} must be a whole number from ${min} to ${max}`);
  };
  int('maxAttempts', 1, RETRY_LIMITS.maxAttempts);
  int('baseDelayMs', RETRY_LIMITS.minDelayMs, RETRY_LIMITS.maxDelayMs);
  int('maxDelayMs', RETRY_LIMITS.minDelayMs, RETRY_LIMITS.maxDelayMs);
  const f = r.factor;
  if (
    typeof f !== 'number' ||
    !Number.isFinite(f) ||
    f < 1 ||
    f > RETRY_LIMITS.maxFactor
  )
    errors.push(`factor must be a number from 1 to ${RETRY_LIMITS.maxFactor}`);
  if (
    typeof r.baseDelayMs === 'number' &&
    typeof r.maxDelayMs === 'number' &&
    r.baseDelayMs > r.maxDelayMs
  )
    errors.push('baseDelayMs must not exceed maxDelayMs');
  return errors;
}

/** Delay before the next try, given how many attempts have already been made (>= 1). Deterministic (no jitter), so it is testable and reproducible. */
export function nextDelayMs(policy: RetryPolicy, attemptsMade: number): number {
  const exp =
    policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attemptsMade - 1));
  return Math.min(policy.maxDelayMs, Math.round(exp));
}

export interface RetryDecision {
  retry: boolean;
  delayMs?: number;
  reason: string;
}

export function decideRetry(args: {
  policy: RetryPolicy;
  attemptsMade: number;
  error: unknown;
  sideEffect: SideEffect;
}): RetryDecision {
  const { policy, attemptsMade, error, sideEffect } = args;
  if (sideEffect === 'FINANCIAL') {
    return {
      retry: false,
      reason:
        'Financial actions are never retried automatically; an authorised person must review and retry',
    };
  }
  const kind: ErrorClass =
    error instanceof ActionError ? error.kind : 'RETRYABLE';
  if (kind === 'PERMANENT')
    return { retry: false, reason: 'Permanent error — retrying cannot help' };
  if (attemptsMade >= policy.maxAttempts)
    return { retry: false, reason: `Gave up after ${attemptsMade} attempt(s)` };
  return {
    retry: true,
    delayMs: nextDelayMs(policy, attemptsMade),
    reason: `Will retry (attempt ${attemptsMade + 1} of ${policy.maxAttempts})`,
  };
}
