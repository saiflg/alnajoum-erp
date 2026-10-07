/** Shapes returned by /api/v1/workflows and /api/v1/automation (Phase 21). Mirrors apps/api/src/modules/workflows. */

export type NodeType = 'TRIGGER' | 'CONDITION' | 'ACTION' | 'APPROVAL' | 'DELAY' | 'WAIT' | 'ESCALATION' | 'END';
export type EdgeLabel = 'default' | 'true' | 'false' | 'approved' | 'rejected' | 'timeout';

export interface WfNode {
  id: string;
  type: NodeType;
  name?: string;
  config?: Record<string, unknown>;
}
export interface WfEdge {
  from: string;
  to: string;
  label?: EdgeLabel;
}
export interface WfGraph {
  nodes: WfNode[];
  edges: WfEdge[];
}

export type WorkflowStatus = 'DRAFT' | 'TESTING' | 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'ARCHIVED';

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  isDemo: boolean;
  triggerEvent: string | null;
  latestVersion: number;
  activeVersionId: string | null;
  branchId: string | null;
  updatedAt: string;
  _count: { executions: number };
}

export interface GraphIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
}
export interface ValidationReport {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
  triggerEvent: string | null;
}

export interface WorkflowVersionRow {
  id: string;
  version: number;
  isLocked: boolean;
  lockedAt: string | null;
  changeReason: string | null;
  createdAt: string;
  validation: ValidationReport | null;
  graph: WfGraph;
  retryPolicy: Record<string, unknown> | null;
}

export interface WorkflowDetail extends Omit<WorkflowSummary, '_count'> {
  versions: WorkflowVersionRow[];
}

export interface TriggerInfo {
  type: string;
  label: string;
  description: string;
  fields: string[];
}
export interface ActionInfoRow {
  key: string;
  label: string;
  sideEffect: 'NONE' | 'NOTIFY' | 'FINANCIAL';
  requiredPermissions: string[];
}
export interface Catalog {
  triggers: TriggerInfo[];
  dynamicTriggers: { prefix: string; description: string }[];
  unavailableTriggers: { type: string; reason: string }[];
  actions: ActionInfoRow[];
  nodeTypes: NodeType[];
  fieldsByTrigger: Record<string, string[]>;
}

export interface SimulationStep {
  nodeId: string;
  type: NodeType;
  name?: string;
  outcome: string;
  detail?: Record<string, unknown>;
}
export interface Simulation {
  steps: SimulationStep[];
  completed: boolean;
  stoppedBecause?: string;
  wouldRun: { nodeId: string; action: string; label: string; sideEffect: string }[];
  warnings: string[];
}

export type ExecutionStatus = 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'DEAD_LETTERED';

export interface ExecutionRow {
  id: string;
  workflowId: string;
  versionNo: number;
  mode: 'LIVE' | 'TEST';
  status: ExecutionStatus;
  currentNodeId: string | null;
  entityType: string | null;
  entityId: string | null;
  correlationId: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  nextRunAt: string | null;
  workflow: { name: string };
}

export interface StepRow {
  id: string;
  nodeId: string;
  nodeType: NodeType;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'WAITING' | 'RETRYING';
  attempts: number;
  input: unknown;
  output: unknown;
  trace: { path: string; field: string; op: string; actual: unknown; expected: unknown; result: boolean; note?: string }[] | null;
  error: string | null;
  idempotencyKey: string;
  mocked: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface DeadLetterRow {
  id: string;
  executionId: string;
  nodeId: string | null;
  reason: string;
  error: string | null;
  retryCount: number;
  status: 'OPEN' | 'RETRIED' | 'CANCELLED' | 'RESOLVED';
  correlationId: string;
  createdAt: string;
  resolutionNote: string | null;
  execution: { id: string; workflowId: string; entityType: string | null; entityId: string | null; workflow: { name: string } };
}

export interface ExecutionDetail extends ExecutionRow {
  context: Record<string, unknown>;
  waitingFor: Record<string, unknown> | null;
  steps: StepRow[];
  deadLetters: DeadLetterRow[];
  event: { id: string; type: string; source: string; occurredAt: string; entityType: string | null; entityId: string | null } | null;
}

export interface EventRow {
  id: string;
  type: string;
  source: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  entityType: string | null;
  entityId: string | null;
  correlationId: string;
  occurredAt: string;
  error: string | null;
}

export interface AutomationMetrics {
  generatedAt: string;
  workflows: Record<string, number>;
  executions: { last24h: Record<string, number>; last7d: Record<string, number> };
  successRatePercent: { last24h: number | null; last7d: number | null };
  failureRatePercent: { last24h: number | null; last7d: number | null };
  avgCompletionSeconds: number | null;
  deadLettersOpen: number;
  queue: { dueNow: number; eventsPending: number; eventsFailed: number };
  topFailingWorkflows: { workflowId: string; deadLetters: number }[];
}
