import { AiRiskLevel, AiExecutionStatus, AiStepStatus } from '@prisma/client';

/** Who an agent talks to. A customer principal can only ever reach CUSTOMER agents. */
export type AgentAudience =
  'CUSTOMER' | 'STAFF' | 'OPERATIONS' | 'EXECUTIVE' | 'SYSTEM';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/**
 * LEVEL 0 answers only · 1 recommends · 2 creates drafts/tasks · 3 executes low-risk actions ·
 * 4 executes selected approved workflows · 5 high-impact actions require human approval.
 * Level 5 is NOT unrestricted autonomy: HIGH_RISK tools need a human at every level.
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** The authenticated human (or system) an agent run acts for. An agent never has more than this principal. */
export interface Principal {
  identityId: string | null;
  kind: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  companyId: string | null;
  branchId: string | null;
  customerId: string | null;
  staffId: string | null;
  roles: string[];
  permissions: string[];
  /** Staff confined to their branch (branch managers, front-line staff). Company-wide roles are false. */
  branchLimited: boolean;
  isSuperAdmin: boolean;
}

export interface AgentConfig {
  /** Tool keys this agent may call (a closed list; anything else is refused and logged). */
  tools: string[];
  allowedActions: string[];
  prohibitedActions: string[];
  autonomyLevel: AutonomyLevel;
  provider: string; // "router" (the active integration) | "mock"
  fallbackProvider?: string;
  model?: string;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  maxToolCalls: number;
  maxRetries: number;
  maxDepth: number;
  timeoutMs: number;
  /** Per execution. */
  budget: { maxTokens: number; maxCostMicros: number };
  approvalRequirements: string[];
  escalationPolicy: {
    onLowConfidence: 'HANDOFF' | 'NONE';
    onToolError: 'HANDOFF' | 'NONE';
  };
  audit: { storeSteps: boolean };
  /** Agents this one may delegate to (supervisors only). */
  delegates?: string[];
}

export interface AgentDefinition {
  key: string;
  name: string;
  description: string;
  purpose: string;
  audience: AgentAudience;
  promptVersion: string;
  systemPrompt: string;
  config: AgentConfig;
}

/** What a tool returns for the answer to be built from. Money is always a MoneyValue, never prose. */
export interface MoneyValue {
  amount: number;
  currency: string;
}

export interface ToolContext {
  principal: Principal;
  agentKey: string;
  executionId: string;
  correlationId: string;
  conversationId: string | null;
  dryRun: boolean;
  language: string;
  /** Stable key for state-changing tools within this run (execution + tool + normalised input). */
  idempotencyKey: string;
}

export interface ToolResult {
  /** Only these fields reach the model and the answer. Already filtered. */
  data: Record<string, unknown>;
  /** Where the facts came from, e.g. "ERP customer record". Never invented. */
  sources: string[];
  /** A short human description of what changed (state-changing tools). */
  summary?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface ToolDefinition {
  key: string;
  description: string;
  risk: AiRiskLevel;
  /** Audiences whose agents may be given this tool. */
  audiences: AgentAudience[];
  /** A human principal needs ALL of these (checked against their real permissions). Empty for customer self-service. */
  requiredPermissions: string[];
  /** JSON-schema-like description of the input, for the model and for validation. */
  input: Record<string, ToolField>;
  /** True if it changes state: gets idempotency + audit, never runs in dry-run. */
  writes: boolean;
  /** A "recommend" tool only records a suggestion (autonomy level 1+). */
  recommends?: boolean;
  /** MEDIUM actions the principal does for themselves on their own record (e.g. pay my invoice). */
  selfService?: boolean;
  /**
   * HIGH_RISK tools: when approved, does the system carry the action out through the existing business service
   * (true), or does approval only authorise a human to do it in the normal screen (false)?
   */
  executeOnApproval?: boolean;
  /** How long a repeated identical call returns the first result instead of acting again. Default: a day. */
  idempotencyWindow?: 'hour' | 'day';
  /** Describes the action for the approval preview. */
  preview?: (input: Record<string, unknown>) => ActionPreview;
  execute(
    ctx: ToolContext,
    input: Record<string, unknown>,
  ): Promise<ToolResult>;
}

export interface ToolField {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  description: string;
  enum?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface ActionPreview {
  action: string;
  reason?: string;
  affectedCustomer?: string;
  affectedBooking?: string;
  financialImpact?: { amount?: number; currency?: string; note?: string };
  providerImpact?: string;
  risks: string[];
  whatWillHappen: string[];
  requiredApproval: string;
}

/** The one thing a model may say each turn. */
export type ModelAction =
  | {
      action: 'tool';
      tool: string;
      input: Record<string, unknown>;
      why?: string;
    }
  | {
      action: 'final';
      text: string;
      confidence: Confidence;
      sources?: string[];
      needsInfo?: boolean;
    }
  | { action: 'delegate'; agent: string; objective: string }
  | { action: 'handoff'; reason: string };

export interface RunInput {
  agentKey: string;
  objective: string;
  principal: Principal;
  channel:
    | 'PORTAL'
    | 'STAFF'
    | 'WHATSAPP'
    | 'SYSTEM'
    | 'WORKFLOW'
    | 'EVENT'
    | 'SIMULATION';
  language?: string;
  conversationId?: string | null;
  dryRun?: boolean;
  parentExecutionId?: string | null;
  correlationId?: string;
  depth?: number;
  /** Earlier turns of the conversation (already stored; used as untrusted context). */
  history?: { role: 'CUSTOMER' | 'AI' | 'STAFF'; content: string }[];
}

export interface RunResult {
  executionId: string;
  status: AiExecutionStatus;
  message: string;
  confidence: Confidence;
  sources: string[];
  language: string;
  approvals: { id: string; toolKey: string; status: string }[];
  handoff: boolean;
  blocked?: string;
  steps: {
    seq: number;
    kind: string;
    tool?: string;
    status: AiStepStatus;
    note?: string;
  }[];
}

export interface PolicyDecision {
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'PROPOSE_ONLY' | 'DENY';
  reason: string;
  /** Raised as a safety event when true (an attempt that should not have been made). */
  safetyKind?:
    | 'UNAUTHORIZED_ACTION'
    | 'APPROVAL_BYPASS'
    | 'POLICY_VIOLATION'
    | 'TENANT_ESCAPE';
  effectiveAutonomy: AutonomyLevel;
}

export interface ResolvedControls {
  allDisabled: boolean;
  agentDisabled: boolean;
  disabledTools: Set<string>;
  autonomousDisabled: boolean;
  forceApproval: boolean;
  autonomyCap: AutonomyLevel;
  featureFlags: Record<string, boolean>;
  commPolicy: CommunicationPolicy;
}

export interface CommunicationPolicy {
  channels: string[]; // PORTAL, WHATSAPP, EMAIL, SMS, PUSH
  /** Allowed sending hours in the company's local time, inclusive start, exclusive end. */
  allowedHours: { start: number; end: number };
  maxMessagesPerCustomerPerDay: number;
  requireApprovalFor: string[]; // e.g. ["payment_reminder"]
  prohibitedContent: string[];
  languages: string[];
}

export const DEFAULT_COMM_POLICY: CommunicationPolicy = {
  channels: ['PORTAL', 'WHATSAPP', 'EMAIL'],
  allowedHours: { start: 7, end: 21 },
  maxMessagesPerCustomerPerDay: 5,
  requireApprovalFor: [],
  prohibitedContent: [
    'guaranteed approval',
    'guaranteed visa',
    'send your password',
  ],
  languages: ['en', 'ha', 'ar'],
};
