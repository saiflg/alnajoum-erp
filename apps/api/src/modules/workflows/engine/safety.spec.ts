import {
  ActionError,
  DEFAULT_RETRY_POLICY,
  decideRetry,
  nextDelayMs,
  validateRetryPolicy,
} from './retry';
import {
  actionKey,
  extendChain,
  executionKey,
  LoopError,
  MAX_CHAIN_DEPTH,
  rootChain,
} from './loop-guard';
import { checkRate, validateRateLimit } from './rate-limit';

describe('retry', () => {
  const policy = {
    maxAttempts: 4,
    baseDelayMs: 1000,
    factor: 2,
    maxDelayMs: 5000,
  };
  it('backs off exponentially and caps the delay', () => {
    expect([1, 2, 3, 4].map((n) => nextDelayMs(policy, n))).toEqual([
      1000, 2000, 4000, 5000,
    ]);
  });
  it('retries a retryable failure until the attempt cap', () => {
    const err = new ActionError('provider timeout', 'RETRYABLE');
    expect(
      decideRetry({
        policy,
        attemptsMade: 1,
        error: err,
        sideEffect: 'NOTIFY',
      }),
    ).toMatchObject({ retry: true, delayMs: 1000 });
    expect(
      decideRetry({ policy, attemptsMade: 4, error: err, sideEffect: 'NOTIFY' })
        .retry,
    ).toBe(false);
  });
  it('never retries a permanent error', () => {
    const d = decideRetry({
      policy,
      attemptsMade: 1,
      error: new ActionError('invalid phone number', 'PERMANENT'),
      sideEffect: 'NOTIFY',
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toContain('Permanent');
  });
  it('NEVER retries a financial action automatically, whatever the error', () => {
    for (const kind of ['RETRYABLE', 'PERMANENT'] as const) {
      const d = decideRetry({
        policy,
        attemptsMade: 1,
        error: new ActionError('gateway timeout', kind),
        sideEffect: 'FINANCIAL',
      });
      expect(d.retry).toBe(false);
      expect(d.reason).toContain('never retried automatically');
    }
    expect(
      decideRetry({
        policy,
        attemptsMade: 1,
        error: new Error('boom'),
        sideEffect: 'FINANCIAL',
      }).retry,
    ).toBe(false);
  });
  it('treats an unclassified error as retryable for non-financial work, within the cap', () => {
    expect(
      decideRetry({
        policy,
        attemptsMade: 1,
        error: new Error('boom'),
        sideEffect: 'NONE',
      }).retry,
    ).toBe(true);
  });
  it('validates a policy', () => {
    expect(validateRetryPolicy(DEFAULT_RETRY_POLICY)).toEqual([]);
    expect(
      validateRetryPolicy({
        maxAttempts: 0,
        baseDelayMs: 5,
        factor: 0.5,
        maxDelayMs: 1,
      }).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      validateRetryPolicy({
        maxAttempts: 99,
        baseDelayMs: 1000,
        factor: 2,
        maxDelayMs: 2000,
      })[0],
    ).toContain('maxAttempts');
    expect(
      validateRetryPolicy({
        maxAttempts: 3,
        baseDelayMs: 9000,
        factor: 2,
        maxDelayMs: 2000,
      }).join(),
    ).toContain('must not exceed');
    expect(validateRetryPolicy(null)).toHaveLength(1);
  });
});

describe('loop guard', () => {
  it('lets a normal cascade through', () => {
    const c1 = extendChain(rootChain(), 'wfA', 'ev1');
    const c2 = extendChain(c1, 'wfB', 'ev2');
    expect(c2.workflowChain).toEqual(['wfA', 'wfB']);
  });
  it('stops A → B → A', () => {
    const c = extendChain(extendChain(rootChain(), 'wfA', 'ev1'), 'wfB', 'ev2');
    expect(() => extendChain(c, 'wfA', 'ev3')).toThrow(LoopError);
    try {
      extendChain(c, 'wfA', 'ev3');
    } catch (e) {
      expect((e as LoopError).reason).toBe('CYCLE');
    }
  });
  it('stops a runaway cascade at the depth limit', () => {
    let c = rootChain();
    for (let i = 0; i < MAX_CHAIN_DEPTH; i++)
      c = extendChain(c, `wf${i}`, `ev${i}`);
    expect(() => extendChain(c, 'another', 'evX')).toThrow(/deep/);
  });
  it('stops a replay of an event already handled in the chain', () => {
    const c = extendChain(rootChain(), 'wfA', 'ev1');
    expect(() => extendChain(c, 'wfB', 'ev1')).toThrow(/already been handled/);
  });
  it('does not mutate the chain it was given', () => {
    const root = rootChain();
    extendChain(root, 'wfA', 'ev1');
    expect(root).toEqual({ workflowChain: [], eventChain: [] });
  });
  it('execution keys ignore the version, so a replay after a new version is still deduplicated', () => {
    expect(executionKey('wf1', 'ev1')).toBe(executionKey('wf1', 'ev1'));
    expect(executionKey('wf1', 'ev1')).not.toBe(executionKey('wf1', 'ev2'));
    expect(executionKey('wf1', 'ev1')).not.toBe(executionKey('wf2', 'ev1'));
  });
  it('action keys are unique per execution and step but stable across retries', () => {
    expect(actionKey('ex1', 'pay')).toBe(actionKey('ex1', 'pay'));
    expect(actionKey('ex1', 'pay')).not.toBe(actionKey('ex1', 'mail'));
    expect(actionKey('ex1', 'pay')).not.toBe(actionKey('ex2', 'pay'));
  });
});

describe('rate limit', () => {
  const limit = { max: 3, windowMs: 60_000 };
  it('allows up to the limit then throttles with a retry-after', () => {
    let counter = null as ReturnType<typeof checkRate>['counter'] | null;
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const d = checkRate(counter, limit, 1_000 + i);
      counter = d.counter;
      results.push(d.allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
    expect(checkRate(counter, limit, 10_000).retryAfterMs).toBe(
      1_000 + 60_000 - 10_000,
    );
  });
  it('starts a fresh window after it expires', () => {
    const full = { windowStart: 0, count: 3 };
    expect(checkRate(full, limit, 59_999).allowed).toBe(false);
    expect(checkRate(full, limit, 60_000)).toMatchObject({
      allowed: true,
      counter: { windowStart: 60_000, count: 1 },
    });
  });
  it('a throttled request does not consume capacity', () => {
    const full = { windowStart: 0, count: 3 };
    expect(checkRate(full, limit, 10).counter).toEqual(full);
  });
  it('supports a cost greater than one and refuses what cannot fit', () => {
    expect(checkRate(null, limit, 0, 4).allowed).toBe(false);
    expect(checkRate(null, limit, 0, 3).allowed).toBe(true);
  });
  it('validates limits', () => {
    expect(validateRateLimit({ max: 10, windowMs: 60_000 })).toEqual([]);
    expect(validateRateLimit({ max: 0, windowMs: 10 }).length).toBe(2);
    expect(validateRateLimit(undefined)).toHaveLength(1);
  });
});
