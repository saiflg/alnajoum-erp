import type { EdgeLabel, NodeType, WfGraph, WfNode } from '@/lib/workflow-types';

/** Connections each step type must / may have — mirrors the server's EDGE_RULES, so the UI never offers an invalid one. */
export const OUTPUTS: Record<NodeType, { required: EdgeLabel[]; optional: EdgeLabel[] }> = {
  TRIGGER: { required: ['default'], optional: [] },
  CONDITION: { required: ['true', 'false'], optional: [] },
  ACTION: { required: ['default'], optional: [] },
  APPROVAL: { required: ['approved', 'rejected'], optional: ['timeout'] },
  DELAY: { required: ['default'], optional: [] },
  WAIT: { required: ['default'], optional: ['timeout'] },
  ESCALATION: { required: ['default'], optional: [] },
  END: { required: [], optional: [] },
};

export const LABEL_TEXT: Record<EdgeLabel, string> = {
  default: 'then',
  true: 'if yes',
  false: 'if no',
  approved: 'if approved',
  rejected: 'if rejected',
  timeout: 'if it times out',
};

export const TYPE_META: Record<NodeType, { label: string; tone: string; hint: string }> = {
  TRIGGER: { label: 'Trigger', tone: 'bg-sky-100 text-sky-800 border-sky-200', hint: 'What starts the workflow' },
  CONDITION: { label: 'Condition', tone: 'bg-violet-100 text-violet-800 border-violet-200', hint: 'Choose a path based on the data' },
  ACTION: { label: 'Action', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200', hint: 'Do something (task, message, note…)' },
  APPROVAL: { label: 'Approval', tone: 'bg-amber-100 text-amber-800 border-amber-200', hint: 'Wait for a person to approve' },
  DELAY: { label: 'Delay', tone: 'bg-slate-100 text-slate-700 border-slate-200', hint: 'Wait a set time' },
  WAIT: { label: 'Wait for event', tone: 'bg-slate-100 text-slate-700 border-slate-200', hint: 'Wait until something happens' },
  ESCALATION: { label: 'Escalation', tone: 'bg-rose-100 text-rose-800 border-rose-200', hint: 'Escalate over time' },
  END: { label: 'End', tone: 'bg-slate-800 text-white border-slate-800', hint: 'The workflow finishes' },
};

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'CONDITION':
      return { condition: { field: '', op: 'eq', value: '' } };
    case 'ACTION':
      return { action: 'audit.note', note: '' };
    case 'APPROVAL':
      return { approvalType: 'GENERAL', timeoutMs: 24 * 3_600_000 };
    case 'DELAY':
      return { durationMs: 3_600_000 };
    case 'WAIT':
      return { until: 'payment.succeeded', timeoutMs: 24 * 3_600_000 };
    case 'ESCALATION':
      return { steps: [{ afterMs: 3_600_000, action: 'task.create', config: { title: '', assignTo: { mode: 'ROLE', role: 'BRANCH_MANAGER' } } }] };
    default:
      return {};
  }
}

export function starterGraph(eventType: string): WfGraph {
  return {
    nodes: [
      { id: 'start', type: 'TRIGGER', name: 'Start', config: { event: eventType } },
      { id: 'done', type: 'END', name: 'End' },
    ],
    edges: [{ from: 'start', to: 'done' }],
  };
}

export const nextOf = (g: WfGraph, id: string, label: EdgeLabel): string => g.edges.find((e) => e.from === id && (e.label ?? 'default') === label)?.to ?? '';

/** Set (or clear, with '') one outgoing connection. Returns a new graph. */
export function setNext(g: WfGraph, id: string, label: EdgeLabel, to: string): WfGraph {
  const rest = g.edges.filter((e) => !(e.from === id && (e.label ?? 'default') === label));
  return { ...g, edges: to ? [...rest, { from: id, to, ...(label === 'default' ? {} : { label }) }] : rest };
}

export function uniqueId(g: WfGraph, base: string): string {
  const taken = new Set(g.nodes.map((n) => n.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/**
 * Add a step just before the (first) End. If the step that currently leads into that End has
 * a free spot for it, rewire so the new step sits in between — the common "append a step" case
 * needs no manual wiring.
 */
export function addNode(g: WfGraph, type: NodeType): { graph: WfGraph; id: string } {
  const id = uniqueId(g, type.toLowerCase());
  const node: WfNode = { id, type, name: TYPE_META[type].label, config: defaultConfig(type) };
  const end = g.nodes.find((n) => n.type === 'END');
  let graph: WfGraph = { ...g, nodes: end ? [...g.nodes.slice(0, g.nodes.indexOf(end)), node, ...g.nodes.slice(g.nodes.indexOf(end))] : [...g.nodes, node] };
  if (end && type !== 'END') {
    const feeders = graph.edges.filter((e) => e.to === end.id && (e.label ?? 'default') === 'default');
    if (feeders.length === 1) {
      graph = setNext(graph, feeders[0].from, 'default', id);
      graph = setNext(graph, id, 'default', end.id);
    }
  }
  return { graph, id };
}

export function removeNode(g: WfGraph, id: string): WfGraph {
  return { nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) };
}

/** Steps in the order they would run (breadth-first from the trigger); unreachable ones follow. */
export function orderedNodes(g: WfGraph): WfNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: WfNode[] = [];
  const seen = new Set<string>();
  const queue = g.nodes.filter((n) => n.type === 'TRIGGER').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id) as WfNode);
    for (const e of g.edges.filter((x) => x.from === id)) queue.push(e.to);
  }
  for (const n of g.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

export function nodeSummary(n: WfNode): string {
  const c = n.config ?? {};
  switch (n.type) {
    case 'TRIGGER':
      return c.schedule ? `Schedule: ${String((c.schedule as { frequency?: string }).frequency ?? '')}` : `When: ${String(c.event ?? '—')}`;
    case 'ACTION':
      return String(c.action ?? '—');
    case 'APPROVAL':
      return `Approval: ${String(c.approvalType ?? '—')}`;
    case 'DELAY':
      return `Wait ${humanDuration(Number(c.durationMs))}`;
    case 'WAIT':
      return `Wait for ${String(c.until ?? '—')} (max ${humanDuration(Number(c.timeoutMs))})`;
    case 'ESCALATION':
      return `${Array.isArray(c.steps) ? c.steps.length : 0} escalation level(s)`;
    case 'CONDITION': {
      const cond = c.condition as { field?: string; op?: string } | undefined;
      return cond?.field ? `${cond.field} ${cond.op ?? ''}` : 'Condition';
    }
    default:
      return '';
  }
}

export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}
