/**
 * Phase 21 — rate limits for automation.
 *
 * A pure fixed-window decision: given the current counter for one
 * (tenant, channel/provider/workflow) key, say whether one more unit is allowed
 * and what the counter becomes. The caller persists the counter atomically; this
 * module only decides, so it is deterministic and testable. Throttled work is
 * deferred (retry after `retryAfterMs`), not dropped.
 */

export interface RateLimit {
  max: number;
  windowMs: number;
}
export interface Counter {
  windowStart: number; // epoch ms
  count: number;
}
export interface RateDecision {
  allowed: boolean;
  counter: Counter;
  /** When throttled: ms until the window resets. */
  retryAfterMs: number;
}

export function validateRateLimit(l: unknown): string[] {
  if (!l || typeof l !== 'object') return ['A rate limit must be an object'];
  const { max, windowMs } = l as Partial<RateLimit>;
  const errors: string[] = [];
  if (
    typeof max !== 'number' ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > 1_000_000
  )
    errors.push('max must be a whole number from 1 to 1,000,000');
  if (
    typeof windowMs !== 'number' ||
    !Number.isInteger(windowMs) ||
    windowMs < 1000 ||
    windowMs > 31 * 24 * 3600_000
  )
    errors.push('windowMs must be from 1 second to 31 days');
  return errors;
}

export function checkRate(
  current: Counter | null,
  limit: RateLimit,
  now: number,
  cost = 1,
): RateDecision {
  const fresh =
    !current ||
    now - current.windowStart >= limit.windowMs ||
    now < current.windowStart;
  const base: Counter = fresh ? { windowStart: now, count: 0 } : current;
  if (base.count + cost > limit.max) {
    return {
      allowed: false,
      counter: base,
      retryAfterMs: Math.max(0, base.windowStart + limit.windowMs - now),
    };
  }
  return {
    allowed: true,
    counter: { windowStart: base.windowStart, count: base.count + cost },
    retryAfterMs: 0,
  };
}

/** Sensible starting ceilings per tenant; each is configurable per tenant later. */
export const DEFAULT_LIMITS: Record<string, RateLimit> = {
  'messages.minute': { max: 60, windowMs: 60_000 },
  'messages.day': { max: 5_000, windowMs: 24 * 3600_000 },
  'executions.minute': { max: 300, windowMs: 60_000 },
  'supplier.requests.minute': { max: 30, windowMs: 60_000 },
  'payment.attempts.hour': { max: 20, windowMs: 3600_000 },
};
