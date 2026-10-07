import { WorkflowAction } from './actions/action.types';
import { fieldsFor, isKnownTrigger } from './engine/catalog';
import { fieldAllowed } from './engine/conditions';
import {
  GraphIssue,
  validateGraph,
  WorkflowGraph,
  WorkflowNode,
} from './engine/graph';
import { validateRetryPolicy } from './engine/retry';
import { validateSchedule } from './engine/schedule';
import { validateTemplate } from './engine/template';

export interface ValidationReport {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
  /** The event type the workflow will be matched on once active, e.g. `payment.succeeded` or `schedule.<id>`. */
  triggerEvent: string | null;
}

export interface ValidationDeps {
  /** Looks an action up by key; unknown keys are an error. */
  getAction(key: string): WorkflowAction | undefined;
  knownActionKeys: ReadonlySet<string>;
  /**
   * The permissions held by the person saving/activating. A workflow cannot use an action its
   * author could not perform by hand — otherwise automation would be a privilege-escalation
   * path. `null` skips the check (used only for read-only re-validation).
   */
  authorPermissions: readonly string[] | null;
  workflowId: string;
}

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object')
    Object.values(v as Record<string, unknown>).forEach((x) => strings(x, out));
  return out;
};

/**
 * The single gate for activation. A workflow with any error must not be activated.
 * Checks: graph shape (trigger, reachability, cycles, dead ends, branches, timeouts), the
 * trigger (a real event or a valid schedule), every action's own configuration, every
 * template variable against what the trigger provides, the retry policy, and the author's
 * permission for each action.
 */
export function validateWorkflowVersion(
  input: { graph: unknown; retryPolicy?: unknown },
  deps: ValidationDeps,
): ValidationReport {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) =>
    errors.push({ level: 'error', code, message, nodeId });
  const warn = (code: string, message: string, nodeId?: string) =>
    warnings.push({ level: 'warning', code, message, nodeId });

  // ---- trigger first: it decides which fields are available everywhere else
  let triggerEvent: string | null = null;
  const rawGraph = input.graph as WorkflowGraph | undefined;
  const nodes: WorkflowNode[] = Array.isArray(rawGraph?.nodes)
    ? rawGraph.nodes
    : [];
  const trigger = nodes.find((n) => n?.type === 'TRIGGER');
  const tcfg = (trigger?.config ?? {}) as {
    event?: unknown;
    schedule?: unknown;
  };
  if (trigger) {
    if (tcfg.event !== undefined && tcfg.schedule !== undefined)
      err(
        'TRIGGER_AMBIGUOUS',
        'A trigger is either an event or a schedule, not both',
        trigger.id,
      );
    else if (tcfg.schedule !== undefined) {
      for (const m of validateSchedule(tcfg.schedule))
        err('INVALID_SCHEDULE', m, trigger.id);
      triggerEvent = `schedule.${deps.workflowId.toLowerCase()}`;
    } else if (typeof tcfg.event === 'string') {
      if (!isKnownTrigger(tcfg.event))
        err(
          'UNKNOWN_TRIGGER',
          `"${tcfg.event}" is not an available trigger`,
          trigger.id,
        );
      else triggerEvent = tcfg.event;
    } else
      err(
        'MISSING_TRIGGER_EVENT',
        'The trigger needs an event or a schedule',
        trigger.id,
      );
  }
  const allowed = fieldsFor(triggerEvent ?? undefined);

  // ---- graph structure (the single graph validator)
  for (const i of validateGraph(input.graph, {
    knownActions: deps.knownActionKeys,
    allowedFields: allowed,
  }))
    (i.level === 'error' ? errors : warnings).push(i);

  // ---- per-node checks that need the action registry and the author's permissions
  const need = new Set<string>();
  const checkAction = (
    nodeId: string,
    key: unknown,
    config: Record<string, unknown>,
  ) => {
    if (typeof key !== 'string') return;
    const action = deps.getAction(key);
    if (!action) return; // already reported as UNKNOWN_ACTION
    for (const m of action.validate(config))
      err('INVALID_ACTION_CONFIG', `Step "${nodeId}" (${key}): ${m}`, nodeId);
    for (const p of action.requiredPermissions) need.add(p);
    for (const s of strings(config)) {
      if (!s.includes('{{')) continue;
      for (const t of validateTemplate(s, allowed))
        err('INVALID_TEMPLATE', `Step "${nodeId}": ${t.message}`, nodeId);
    }
  };
  for (const n of nodes) {
    const cfg = n?.config ?? {};
    if (n?.type === 'ACTION') checkAction(n.id, cfg.action, cfg);
    if (n?.type === 'ESCALATION' && Array.isArray(cfg.steps)) {
      (
        cfg.steps as { action?: unknown; config?: Record<string, unknown> }[]
      ).forEach((s, i) => {
        if (typeof s?.action !== 'string' || !deps.getAction(s.action))
          err(
            'UNKNOWN_ACTION',
            `Step "${n.id}" level ${i + 1}: unknown action`,
            n.id,
          );
        else checkAction(n.id, s.action, s.config ?? {});
      });
    }
    if (n?.type === 'APPROVAL') {
      for (const f of ['amountField', 'currencyField'] as const) {
        const v = cfg[f];
        if (
          v !== undefined &&
          (typeof v !== 'string' || !fieldAllowed(v, allowed))
        )
          err(
            'INVALID_FIELD',
            `Step "${n.id}": ${f} ${JSON.stringify(v)} is not available for this trigger`,
            n.id,
          );
      }
    }
    if (
      n?.type === 'WAIT' &&
      typeof cfg.until === 'string' &&
      !isKnownTrigger(cfg.until)
    )
      err(
        'UNKNOWN_TRIGGER',
        `Step "${n.id}" waits for "${cfg.until}", which is not an available event`,
        n.id,
      );
    if (
      n?.type === 'ESCALATION' &&
      typeof cfg.stopOnEvent === 'string' &&
      !isKnownTrigger(cfg.stopOnEvent)
    )
      err(
        'UNKNOWN_TRIGGER',
        `Step "${n.id}" stops on "${cfg.stopOnEvent}", which is not an available event`,
        n.id,
      );
  }

  // ---- retry policy
  if (input.retryPolicy !== undefined && input.retryPolicy !== null)
    for (const m of validateRetryPolicy(input.retryPolicy))
      err('INVALID_RETRY_POLICY', m);

  // ---- author permissions
  if (deps.authorPermissions) {
    const held = new Set(deps.authorPermissions);
    for (const p of need)
      if (!held.has(p))
        err(
          'MISSING_PERMISSION',
          `You do not have the "${p}" permission that one of the actions in this workflow needs, so you cannot save or activate it`,
        );
  }

  // ---- gentle warnings
  if (
    nodes.length > 0 &&
    !nodes.some((n) => n?.type === 'ACTION' || n?.type === 'ESCALATION')
  )
    warn(
      'NO_ACTIONS',
      'The workflow never does anything — it has no action steps',
    );

  return { ok: errors.length === 0, errors, warnings, triggerEvent };
}
