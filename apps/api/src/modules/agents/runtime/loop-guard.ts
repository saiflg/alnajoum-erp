import { createHash } from 'crypto';

/** Stable hash of a tool call: same tool + same normalised input = same call. */
export function callSignature(
  tool: string,
  input: Record<string, unknown>,
): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return createHash('sha256')
    .update(`${tool}:${JSON.stringify(norm(input))}`)
    .digest('hex')
    .slice(0, 24);
}

export type LoopVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'REPEATED_CALL'
        | 'PING_PONG'
        | 'MAX_STEPS'
        | 'MAX_TOOL_CALLS'
        | 'TIMEOUT'
        | 'DEPTH';
      detail: string;
    };

export interface LoopState {
  steps: number;
  toolCalls: number;
  startedAt: number;
  signatures: string[];
  depth: number;
  /** Agent keys on the delegation chain, to catch A → B → A. */
  chain: string[];
}

export interface LoopLimits {
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  maxDepth: number;
  /** The same call more than this many times is a loop. */
  maxRepeats: number;
}

/**
 * Stops runaway agents: a hard cap on steps, tool calls, wall-clock time and delegation depth, plus detection
 * of the same call repeating and of two calls alternating (A,B,A,B). Called before every step.
 */
export function checkLoop(
  state: LoopState,
  limits: LoopLimits,
  now = Date.now(),
): LoopVerdict {
  if (state.depth > limits.maxDepth)
    return {
      ok: false,
      reason: 'DEPTH',
      detail: `delegation deeper than ${limits.maxDepth}`,
    };
  if (state.steps >= limits.maxSteps)
    return {
      ok: false,
      reason: 'MAX_STEPS',
      detail: `more than ${limits.maxSteps} steps`,
    };
  if (state.toolCalls >= limits.maxToolCalls)
    return {
      ok: false,
      reason: 'MAX_TOOL_CALLS',
      detail: `more than ${limits.maxToolCalls} tool calls`,
    };
  if (now - state.startedAt > limits.timeoutMs)
    return {
      ok: false,
      reason: 'TIMEOUT',
      detail: `over ${limits.timeoutMs} ms`,
    };
  const s = state.signatures;
  const last = s[s.length - 1];
  if (last && s.filter((x) => x === last).length > limits.maxRepeats)
    return {
      ok: false,
      reason: 'REPEATED_CALL',
      detail: 'the same call was made again and again',
    };
  if (s.length >= 4) {
    const [a, b, c, d] = s.slice(-4);
    if (a === c && b === d && a !== b)
      return {
        ok: false,
        reason: 'PING_PONG',
        detail: 'two calls alternating',
      };
  }
  return { ok: true };
}

/** A delegation must not return to an agent already on the chain. */
export function delegationCreatesCycle(
  chain: string[],
  target: string,
): boolean {
  return chain.includes(target);
}
