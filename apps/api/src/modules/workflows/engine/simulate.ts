/**
 * Phase 21 — dry run.
 *
 * "Show me what would happen if this booking were cancelled": walk a workflow's
 * graph against a sample event and report, step by step, which conditions pass,
 * which actions WOULD run (with their messages rendered), and where approvals,
 * delays and waits would pause it — without touching the database, a provider, a
 * customer or a ledger. Conditions are evaluated for real by the same evaluator
 * the live engine uses, so a dry run cannot disagree with a live run about the
 * path taken. Delays, waits and approvals are assumed to be satisfied.
 */
import { evaluateCondition } from './conditions';
import { EdgeLabel, nextNode, WorkflowGraph, WorkflowNode } from './graph';
import { extractVariables } from './template';
import { readPath } from './conditions';
import { SideEffect } from './retry';

export interface ActionInfo {
  label: string;
  sideEffect: SideEffect;
}

export interface SimulationStep {
  nodeId: string;
  type: WorkflowNode['type'];
  name?: string;
  outcome: string;
  /** What the step would do, or why it went the way it did. */
  detail?: Record<string, unknown>;
}

export interface Simulation {
  steps: SimulationStep[];
  completed: boolean;
  stoppedBecause?: string;
  /** Every action that would have run, in order. */
  wouldRun: {
    nodeId: string;
    action: string;
    label: string;
    sideEffect: SideEffect;
  }[];
  /** Template variables the sample event does not supply — they would fail a live run. */
  warnings: string[];
}

export interface SimulateOptions {
  actions: ReadonlyMap<string, ActionInfo>;
  /** How approvals resolve in the simulation. Default 'approved'. */
  assumeApproval?: 'approved' | 'rejected';
  maxSteps?: number;
}

/** Every `{{variable}}` used by any string in a config, so missing ones can be flagged. */
function templateVariables(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    try {
      for (const v of extractVariables(value)) out.add(v);
    } catch {
      /* a malformed template is reported by validation; not the dry run's job */
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => templateVariables(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) =>
      templateVariables(v, out),
    );
  }
}

export function simulateWorkflow(
  graph: WorkflowGraph,
  context: unknown,
  opts: SimulateOptions,
): Simulation {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const result: Simulation = {
    steps: [],
    completed: false,
    wouldRun: [],
    warnings: [],
  };
  const maxSteps = opts.maxSteps ?? 200;
  const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
  if (!trigger) {
    result.stoppedBecause = 'The workflow has no trigger';
    return result;
  }

  let current: WorkflowNode | undefined = trigger;
  const seen = new Set<string>();

  for (let i = 0; current && i < maxSteps; i++) {
    if (seen.has(current.id)) {
      result.stoppedBecause = `Step "${current.id}" was reached twice (loop)`;
      return result;
    }
    seen.add(current.id);
    const n: WorkflowNode = current;
    const cfg = n.config ?? {};
    let label: EdgeLabel = 'default';
    const step: SimulationStep = {
      nodeId: n.id,
      type: n.type,
      name: n.name,
      outcome: 'passed',
    };

    switch (n.type) {
      case 'TRIGGER': {
        if (cfg.condition) {
          const r = evaluateCondition(cfg.condition as never, context);
          step.detail = { condition: r.result, trace: r.trace };
          if (!r.result) {
            step.outcome =
              'trigger condition not met — the workflow would not start';
            result.steps.push(step);
            result.stoppedBecause =
              'The trigger condition is not met for this event';
            return result;
          }
        }
        break;
      }
      case 'CONDITION': {
        const r = evaluateCondition(cfg.condition as never, context);
        label = r.result ? 'true' : 'false';
        step.outcome = r.result ? 'true' : 'false';
        step.detail = { trace: r.trace };
        break;
      }
      case 'ACTION': {
        const key = String(cfg.action);
        const info = opts.actions.get(key);
        step.outcome = 'would run';
        step.detail = {
          action: key,
          label: info?.label ?? key,
          sideEffect: info?.sideEffect ?? 'NONE',
        };
        result.wouldRun.push({
          nodeId: n.id,
          action: key,
          label: info?.label ?? key,
          sideEffect: info?.sideEffect ?? 'NONE',
        });
        const vars = new Set<string>();
        templateVariables(cfg, vars);
        for (const v of vars) {
          if (
            readPath(context, v) === undefined ||
            readPath(context, v) === null
          ) {
            result.warnings.push(
              `Step "${n.id}" uses {{${v}}}, which this event does not provide`,
            );
          }
        }
        break;
      }
      case 'APPROVAL': {
        const approved = (opts.assumeApproval ?? 'approved') === 'approved';
        label = approved ? 'approved' : 'rejected';
        step.outcome = `approval requested (${String(cfg.approvalType)}); assumed ${label}`;
        break;
      }
      case 'DELAY':
        step.outcome = `would wait ${String(cfg.durationMs)} ms`;
        break;
      case 'WAIT':
        step.outcome = `would wait for ${String(cfg.until)}; assumed it arrives`;
        break;
      case 'ESCALATION':
        step.outcome = `would escalate through ${Array.isArray(cfg.steps) ? cfg.steps.length : 0} level(s)`;
        break;
      case 'END':
        step.outcome = 'end';
        result.steps.push(step);
        result.completed = true;
        return result;
    }

    result.steps.push(step);
    const nextId = nextNode(graph, n.id, label);
    if (!nextId) {
      result.stoppedBecause = `Step "${n.id}" has no "${label}" connection`;
      return result;
    }
    current = byId.get(nextId);
  }
  result.stoppedBecause =
    result.stoppedBecause ?? 'Stopped after the step limit';
  return result;
}
