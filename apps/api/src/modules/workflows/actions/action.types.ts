import { ChainContext } from '../engine/loop-guard';
import { SideEffect } from '../engine/retry';

/** What the engine hands an action. Everything an action may read is here — it never receives a request or a user session. */
export interface ActionContext {
  executionId: string;
  nodeId: string;
  /** One side effect per step per execution — pass it to anything that can dedupe. */
  idempotencyKey: string;
  mode: 'LIVE' | 'TEST';
  companyId: string;
  branchId: string | null;
  /** The trigger payload plus earlier steps' outputs (`steps.<nodeId>.…`). */
  context: Record<string, unknown>;
  config: Record<string, unknown>;
  /** The cascade that led here, and the id that ties this run to the request that began it. */
  chain: ChainContext;
  correlationId: string;
  /** The identity the workflow acts for (its owner); used where a system action needs an actor. */
  ownerIdentityId: string | null;
  /** Safe `{{variable}}` substitution against `context`; throws a PERMANENT ActionError on a missing variable. */
  render: (template: string) => string;
}

export interface WorkflowAction {
  key: string;
  label: string;
  /** Drives retry rules and the dry-run summary. FINANCIAL actions are never auto-retried. */
  sideEffect: SideEffect;
  /** The author must hold these to put the action in a workflow — a workflow cannot grant what its author lacks. */
  requiredPermissions: string[];
  /** Author-time check of the node's config. */
  validate(config: Record<string, unknown>): string[];
  run(ctx: ActionContext): Promise<Record<string, unknown>>;
  /** Test mode: report what WOULD happen, with no side effect. May still render templates (so test mode catches missing variables). */
  mock(ctx: ActionContext): Record<string, unknown>;
}
