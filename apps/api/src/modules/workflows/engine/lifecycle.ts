/**
 * Phase 21 — workflow lifecycle.
 *
 *   DRAFT ──test──▶ TESTING ──activate──▶ ACTIVE ◀──resume── PAUSED
 *     │                │                    │  └──pause──────▶ │
 *     └────activate────┘                    └──disable──▶ DISABLED
 *   any non-ACTIVE state ──archive──▶ ARCHIVED (final)
 *
 * ACTIVE is the only state that reacts to live events. Pausing or disabling stops NEW
 * executions; ones already running finish on the version they started under (cancel them
 * explicitly if you want them stopped). ARCHIVED is final and cannot be reactivated.
 */
export type WorkflowStatus =
  'DRAFT' | 'TESTING' | 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'ARCHIVED';

const ALLOWED: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  DRAFT: ['TESTING', 'ACTIVE', 'ARCHIVED'],
  TESTING: ['ACTIVE', 'DRAFT', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'DISABLED', 'ACTIVE'], // ACTIVE -> ACTIVE = activating a newer version
  PAUSED: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
  DISABLED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export const canTransition = (
  from: WorkflowStatus,
  to: WorkflowStatus,
): boolean => ALLOWED[from].includes(to);

export const reactsToEvents = (s: WorkflowStatus): boolean => s === 'ACTIVE';

export type ExecutionStatus =
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DEAD_LETTERED';
export const isTerminal = (s: ExecutionStatus): boolean =>
  ['COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].includes(s);

/** Dead-letter reasons where retrying cannot help (the problem is the workflow, not a transient fault). */
const NOT_RETRYABLE =
  /^(LOOP_|GRAPH|VERSION_MISSING|CONDITION_INVALID|UNKNOWN_ACTION|NO_ROUTE|NO_REQUESTER|CONTEXT_TOO_LARGE|TEMPLATE|CROSS_TENANT|ASSIGNEE_NOT_FOUND|NO_CUSTOMER)/;
export const isRetryableReason = (reason: string): boolean =>
  !NOT_RETRYABLE.test(reason);
