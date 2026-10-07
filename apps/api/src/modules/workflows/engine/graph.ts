/**
 * Phase 21 — workflow graph model and activation-time validation.
 *
 * A workflow is a DIRECTED ACYCLIC graph of typed nodes: one TRIGGER, then
 * CONDITION / ACTION / APPROVAL / DELAY / WAIT / ESCALATION nodes, ending at END
 * nodes. It is data, not code. Cycles are rejected outright (a workflow that can
 * revisit a node can run forever; "do this every week" is a schedule on the
 * trigger, not a loop in the graph).
 *
 * validateGraph is the gate for activation: a workflow with any `error` issue
 * must not be activated.
 */
import { validateCondition } from './conditions';

export const NODE_TYPES = [
  'TRIGGER',
  'CONDITION',
  'ACTION',
  'APPROVAL',
  'DELAY',
  'WAIT',
  'ESCALATION',
  'END',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_LABELS = [
  'default',
  'true',
  'false',
  'approved',
  'rejected',
  'timeout',
] as const;
export type EdgeLabel = (typeof EDGE_LABELS)[number];

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name?: string;
  config?: Record<string, unknown>;
}
export interface WorkflowEdge {
  from: string;
  to: string;
  label?: EdgeLabel;
}
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type IssueLevel = 'error' | 'warning';
export interface GraphIssue {
  level: IssueLevel;
  code: string;
  message: string;
  nodeId?: string;
}

export const GRAPH_LIMITS = {
  maxNodes: 50,
  maxEdges: 120,
  /** A single delay/wait/approval timeout may not exceed this. */
  maxTimeoutMs: 90 * 24 * 60 * 60 * 1000,
} as const;

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/** Labels each node type must / may have on its outgoing edges. */
const EDGE_RULES: Record<
  NodeType,
  { required: EdgeLabel[]; optional: EdgeLabel[] }
> = {
  TRIGGER: { required: ['default'], optional: [] },
  CONDITION: { required: ['true', 'false'], optional: [] },
  ACTION: { required: ['default'], optional: [] },
  APPROVAL: { required: ['approved', 'rejected'], optional: ['timeout'] },
  DELAY: { required: ['default'], optional: [] },
  WAIT: { required: ['default'], optional: ['timeout'] },
  ESCALATION: { required: ['default'], optional: [] },
  END: { required: [], optional: [] },
};

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

export interface ValidateGraphOptions {
  /** Actions the engine can actually run; an ACTION node naming anything else is an error. */
  knownActions?: ReadonlySet<string>;
  /** Fields the chosen trigger provides, for checking condition field names. */
  allowedFields?: ReadonlySet<string>;
}

export function validateGraph(
  graph: unknown,
  opts: ValidateGraphOptions = {},
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) =>
    issues.push({ level: 'error', code, message, nodeId });

  if (
    !graph ||
    typeof graph !== 'object' ||
    !Array.isArray((graph as WorkflowGraph).nodes) ||
    !Array.isArray((graph as WorkflowGraph).edges)
  ) {
    err('MALFORMED', 'A workflow needs a list of nodes and a list of edges');
    return issues;
  }
  const { nodes, edges } = graph as WorkflowGraph;
  if (nodes.length === 0) {
    err('EMPTY', 'The workflow has no steps');
    return issues;
  }
  if (nodes.length > GRAPH_LIMITS.maxNodes)
    err(
      'TOO_MANY_NODES',
      `A workflow may have at most ${GRAPH_LIMITS.maxNodes} steps`,
    );
  if (edges.length > GRAPH_LIMITS.maxEdges)
    err(
      'TOO_MANY_EDGES',
      `A workflow may have at most ${GRAPH_LIMITS.maxEdges} connections`,
    );

  // ---- nodes
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !ID_RE.test(n.id)) {
      err(
        'BAD_ID',
        `Step id "${String(n?.id)}" must start with a letter and use only letters, digits, - and _ (max 40)`,
      );
      continue;
    }
    if (byId.has(n.id)) {
      err('DUPLICATE_ID', `Step id "${n.id}" is used more than once`, n.id);
      continue;
    }
    if (!(NODE_TYPES as readonly string[]).includes(n.type)) {
      err(
        'UNKNOWN_TYPE',
        `Step "${n.id}" has an unknown type "${String(n.type)}"`,
        n.id,
      );
      continue;
    }
    byId.set(n.id, n);
  }

  const triggers = [...byId.values()].filter((n) => n.type === 'TRIGGER');
  if (triggers.length === 0) err('NO_TRIGGER', 'The workflow has no trigger');
  if (triggers.length > 1)
    err('MULTIPLE_TRIGGERS', 'A workflow can have only one trigger');
  if (![...byId.values()].some((n) => n.type === 'END'))
    err('NO_END', 'The workflow has no End step');

  // ---- edges
  const out = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const e of edges) {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) {
      err(
        'DANGLING_EDGE',
        `A connection points at a step that does not exist (${String(e?.from)} → ${String(e?.to)})`,
      );
      continue;
    }
    if (
      e.label !== undefined &&
      !(EDGE_LABELS as readonly string[]).includes(e.label)
    ) {
      err(
        'BAD_LABEL',
        `Connection ${e.from} → ${e.to} has an unknown label "${String(e.label)}"`,
        e.from,
      );
      continue;
    }
    if (e.from === e.to) {
      err('SELF_LOOP', `Step "${e.from}" connects to itself`, e.from);
      continue;
    }
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  // ---- per-node rules
  for (const n of byId.values()) {
    const rule = EDGE_RULES[n.type];
    const mine = out.get(n.id) ?? [];
    const labels = mine.map((e) => e.label ?? 'default');

    if (n.type === 'END') {
      if (mine.length > 0)
        err(
          'END_HAS_OUTGOING',
          `End step "${n.id}" cannot lead anywhere`,
          n.id,
        );
    } else {
      for (const need of rule.required) {
        if (!labels.includes(need))
          err(
            mine.length === 0 ? 'DEAD_END' : 'MISSING_BRANCH',
            `Step "${n.id}" (${n.type}) needs a "${need}" connection`,
            n.id,
          );
      }
      for (const l of labels) {
        if (!rule.required.includes(l) && !rule.optional.includes(l))
          err(
            'UNEXPECTED_BRANCH',
            `Step "${n.id}" (${n.type}) cannot have a "${l}" connection`,
            n.id,
          );
      }
      if (new Set(labels).size !== labels.length)
        err(
          'DUPLICATE_BRANCH',
          `Step "${n.id}" has two connections with the same label`,
          n.id,
        );
    }
    if (n.type === 'TRIGGER' && (incoming.get(n.id) ?? 0) > 0)
      err('TRIGGER_HAS_INCOMING', 'Nothing may lead into the trigger', n.id);

    validateNodeConfig(n, opts, err);
  }

  // ---- reachability and cycles (only meaningful with exactly one trigger)
  if (triggers.length === 1) {
    const reachable = new Set<string>();
    const stack = [triggers[0].id];
    while (stack.length) {
      const id = stack.pop() as string;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of out.get(id) ?? []) stack.push(e.to);
    }
    for (const n of byId.values())
      if (!reachable.has(n.id))
        err(
          'UNREACHABLE',
          `Step "${n.id}" can never be reached from the trigger`,
          n.id,
        );
  }

  const cycle = findCycle(byId, out);
  if (cycle)
    err(
      'CYCLE',
      `The workflow loops back on itself: ${cycle.join(' → ')}`,
      cycle[0],
    );

  return issues;
}

function validateNodeConfig(
  n: WorkflowNode,
  opts: ValidateGraphOptions,
  err: (code: string, message: string, nodeId?: string) => void,
): void {
  const cfg = n.config ?? {};
  switch (n.type) {
    case 'CONDITION': {
      if (!('condition' in cfg)) {
        err(
          'MISSING_CONDITION',
          `Condition step "${n.id}" has no condition`,
          n.id,
        );
        break;
      }
      for (const issue of validateCondition(cfg.condition, {
        allowedFields: opts.allowedFields,
      })) {
        err(
          'INVALID_CONDITION',
          `Step "${n.id}": ${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
          n.id,
        );
      }
      break;
    }
    case 'ACTION': {
      if (typeof cfg.action !== 'string' || cfg.action.length === 0) {
        err(
          'MISSING_ACTION',
          `Action step "${n.id}" does not say which action to run`,
          n.id,
        );
      } else if (opts.knownActions && !opts.knownActions.has(cfg.action)) {
        err(
          'UNKNOWN_ACTION',
          `Step "${n.id}": "${cfg.action}" is not an available action`,
          n.id,
        );
      }
      break;
    }
    case 'DELAY': {
      if (!isPositiveInt(cfg.durationMs))
        err(
          'INVALID_TIMEOUT',
          `Delay step "${n.id}" needs a positive whole-number duration`,
          n.id,
        );
      else if (cfg.durationMs > GRAPH_LIMITS.maxTimeoutMs)
        err(
          'INVALID_TIMEOUT',
          `Delay step "${n.id}" is longer than 90 days`,
          n.id,
        );
      break;
    }
    case 'WAIT': {
      if (typeof cfg.until !== 'string' || cfg.until.length === 0)
        err(
          'MISSING_WAIT_TARGET',
          `Wait step "${n.id}" does not say what it is waiting for`,
          n.id,
        );
      if (!isPositiveInt(cfg.timeoutMs))
        err(
          'INVALID_TIMEOUT',
          `Wait step "${n.id}" needs a positive timeout, so it cannot wait forever`,
          n.id,
        );
      else if (cfg.timeoutMs > GRAPH_LIMITS.maxTimeoutMs)
        err(
          'INVALID_TIMEOUT',
          `Wait step "${n.id}" times out after more than 90 days`,
          n.id,
        );
      break;
    }
    case 'APPROVAL': {
      if (typeof cfg.approvalType !== 'string' || cfg.approvalType.length === 0)
        err(
          'MISSING_APPROVAL',
          `Approval step "${n.id}" does not say what is being approved`,
          n.id,
        );
      if (!isPositiveInt(cfg.timeoutMs))
        err(
          'INVALID_TIMEOUT',
          `Approval step "${n.id}" needs a positive timeout`,
          n.id,
        );
      else if (cfg.timeoutMs > GRAPH_LIMITS.maxTimeoutMs)
        err(
          'INVALID_TIMEOUT',
          `Approval step "${n.id}" times out after more than 90 days`,
          n.id,
        );
      break;
    }
    case 'ESCALATION': {
      const steps = cfg.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        err(
          'MISSING_ESCALATION',
          `Escalation step "${n.id}" needs at least one level`,
          n.id,
        );
        break;
      }
      let last = 0;
      for (const s of steps as { afterMs?: unknown }[]) {
        if (!s || !isPositiveInt(s.afterMs)) {
          err(
            'INVALID_TIMEOUT',
            `Escalation step "${n.id}": each level needs a positive "afterMs"`,
            n.id,
          );
          break;
        }
        if (s.afterMs <= last) {
          err(
            'INVALID_TIMEOUT',
            `Escalation step "${n.id}": levels must be in increasing time order`,
            n.id,
          );
          break;
        }
        last = s.afterMs;
      }
      break;
    }
    default:
      break;
  }
}

/** Depth-first search for a cycle; returns the nodes on it, or null. */
function findCycle(
  byId: Map<string, WorkflowNode>,
  out: Map<string, WorkflowEdge[]>,
): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(
    [...byId.keys()].map((k) => [k, WHITE]),
  );
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    colour.set(id, GREY);
    path.push(id);
    for (const e of out.get(id) ?? []) {
      if (colour.get(e.to) === GREY)
        return [...path.slice(path.indexOf(e.to)), e.to];
      if (colour.get(e.to) === WHITE) {
        const found = visit(e.to);
        if (found) return found;
      }
    }
    path.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of byId.keys()) {
    if (colour.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

export const hasErrors = (issues: GraphIssue[]): boolean =>
  issues.some((i) => i.level === 'error');

/** The step an execution moves to next, given the label the current step produced. */
export function nextNode(
  graph: WorkflowGraph,
  fromId: string,
  label: EdgeLabel = 'default',
): string | null {
  const edge = graph.edges.find(
    (e) => e.from === fromId && (e.label ?? 'default') === label,
  );
  return edge ? edge.to : null;
}
