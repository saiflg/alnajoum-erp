/**
 * Phase 21 — loop protection and idempotency keys.
 *
 * Workflow A can emit an event that starts workflow B, which can emit an event
 * that starts A again. Every event an automation emits therefore carries the
 * CHAIN that led to it (which workflows and events, in order). Starting a
 * workflow is refused when:
 *   - the chain is already `MAX_CHAIN_DEPTH` long (a runaway cascade), or
 *   - the same workflow is already in the chain (A -> B -> A), or
 *   - the same event id has already started this workflow (a replay).
 * Refusal is a safe stop, recorded for the dead-letter queue — never a crash and
 * never a silent drop.
 */

export const MAX_CHAIN_DEPTH = 5;

export type LoopReason = 'MAX_DEPTH' | 'CYCLE' | 'DUPLICATE_EVENT';

export class LoopError extends Error {
  constructor(
    message: string,
    readonly reason: LoopReason,
  ) {
    super(message);
  }
}

export interface ChainContext {
  /** Workflows that have already run in this cascade, oldest first. */
  workflowChain: string[];
  /** Events that started them. */
  eventChain: string[];
}

export const rootChain = (): ChainContext => ({
  workflowChain: [],
  eventChain: [],
});

export function extendChain(
  chain: ChainContext,
  workflowId: string,
  eventId: string,
  maxDepth: number = MAX_CHAIN_DEPTH,
): ChainContext {
  if (chain.workflowChain.length >= maxDepth) {
    throw new LoopError(
      `Automation chain is already ${chain.workflowChain.length} deep (limit ${maxDepth}); stopped to avoid a runaway cascade`,
      'MAX_DEPTH',
    );
  }
  if (chain.workflowChain.includes(workflowId)) {
    throw new LoopError(
      `Workflow ${workflowId} is already in this chain (${[...chain.workflowChain, workflowId].join(' → ')}); stopped to avoid a loop`,
      'CYCLE',
    );
  }
  if (chain.eventChain.includes(eventId)) {
    throw new LoopError(
      `Event ${eventId} has already been handled in this chain`,
      'DUPLICATE_EVENT',
    );
  }
  return {
    workflowChain: [...chain.workflowChain, workflowId],
    eventChain: [...chain.eventChain, eventId],
  };
}

/**
 * One execution per workflow per event, whatever version is active when the event
 * is replayed: a unique constraint on this key is what makes a replayed event
 * harmless. (Version is deliberately NOT part of it.)
 */
export const executionKey = (workflowId: string, eventId: string): string =>
  `wf:${workflowId}:ev:${eventId}`;

/**
 * One side-effect per step per execution. Passed to the action as its idempotency
 * key, so a retry or a human re-run of the same step cannot do the thing twice.
 */
export const actionKey = (executionId: string, nodeId: string): string =>
  `ex:${executionId}:node:${nodeId}`;
