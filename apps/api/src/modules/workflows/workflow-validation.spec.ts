import { WorkflowAction } from './actions/action.types';
import { WorkflowGraph } from './engine/graph';
import { validateWorkflowVersion, ValidationDeps } from './workflow-validation';

const mk = (
  key: string,
  perms: string[],
  validate: (c: Record<string, unknown>) => string[] = () => [],
): WorkflowAction => ({
  key,
  label: key,
  sideEffect: 'NOTIFY',
  requiredPermissions: perms,
  validate,
  run: () => Promise.resolve({}),
  mock: () => ({}),
});
const actions = new Map<string, WorkflowAction>([
  [
    'notify.email',
    mk('notify.email', ['workflow:send_messages'], (c) =>
      c.body ? [] : ['body is required'],
    ),
  ],
  ['task.create', mk('task.create', ['crm:task_manage'])],
]);
const deps = (over: Partial<ValidationDeps> = {}): ValidationDeps => ({
  getAction: (k) => actions.get(k),
  knownActionKeys: new Set(actions.keys()),
  authorPermissions: ['workflow:send_messages', 'crm:task_manage'],
  workflowId: 'cabc123',
  ...over,
});

const good = (): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'TRIGGER', config: { event: 'payment.succeeded' } },
    {
      id: 'mail',
      type: 'ACTION',
      config: {
        action: 'notify.email',
        subject: 'Paid {{payment.amount}}',
        body: 'Thanks. Ref {{payment.invoiceId}}',
      },
    },
    { id: 'done', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'mail' },
    { from: 'mail', to: 'done' },
  ],
});
const codes = (g: unknown, d = deps(), retry?: unknown) =>
  validateWorkflowVersion({ graph: g, retryPolicy: retry }, d).errors.map(
    (e) => e.code,
  );

describe('validateWorkflowVersion', () => {
  it('accepts a good workflow and reports its trigger event', () => {
    const r = validateWorkflowVersion({ graph: good() }, deps());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.triggerEvent).toBe('payment.succeeded');
  });
  it('rejects an unknown trigger, and a trigger with neither event nor schedule', () => {
    const g = good();
    g.nodes[0].config = { event: 'made.up' };
    expect(codes(g)).toContain('UNKNOWN_TRIGGER');
    g.nodes[0].config = {};
    expect(codes(g)).toContain('MISSING_TRIGGER_EVENT');
    g.nodes[0].config = {
      event: 'payment.succeeded',
      schedule: { frequency: 'DAILY' },
    };
    expect(codes(g)).toContain('TRIGGER_AMBIGUOUS');
  });
  it('accepts a schedule trigger and derives its private event type', () => {
    const g = good();
    g.nodes[0].config = { schedule: { frequency: 'DAILY', hour: 9 } };
    // A schedule carries no payment fields, so the message must not use them.
    g.nodes[1].config = {
      action: 'notify.email',
      subject: 'Daily digest',
      body: 'Window {{schedule.window}}',
    };
    const r = validateWorkflowVersion({ graph: g }, deps());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.triggerEvent).toBe('schedule.cabc123');
    // ...and using payment fields on a scheduled workflow is caught.
    const bad = good();
    bad.nodes[0].config = { schedule: { frequency: 'DAILY', hour: 9 } };
    expect(codes(bad)).toContain('INVALID_TEMPLATE');
  });
  it('rejects an invalid schedule', () => {
    const g = good();
    g.nodes[0].config = { schedule: { frequency: 'MONTHLY', dayOfMonth: 31 } };
    expect(codes(g)).toContain('INVALID_SCHEDULE');
  });
  it('delegates to the graph validator (a cycle, an unreachable step)', () => {
    const g = good();
    g.nodes.push({ id: 'island', type: 'END' });
    expect(codes(g)).toContain('UNREACHABLE');
    const c = good();
    c.nodes.splice(2, 0, {
      id: 'again',
      type: 'ACTION',
      config: {
        action: 'task.create',
        title: 't',
        assignTo: { mode: 'STAFF', staffId: 's' },
      },
    });
    c.edges = [
      { from: 'start', to: 'mail' },
      { from: 'mail', to: 'again' },
      { from: 'again', to: 'mail' },
    ];
    expect(codes(c)).toContain('CYCLE');
  });
  it("runs each action's own config validation", () => {
    const g = good();
    g.nodes[1].config = { action: 'notify.email', subject: 's' }; // no body
    expect(
      validateWorkflowVersion({ graph: g }, deps()).errors.find(
        (e) => e.code === 'INVALID_ACTION_CONFIG',
      )?.message,
    ).toContain('body is required');
  });
  it('rejects template variables the trigger does not provide', () => {
    const g = good();
    g.nodes[1].config = {
      action: 'notify.email',
      subject: 's',
      body: 'Hi {{customer.passport}} {{booking.reference}}',
    };
    const errs = validateWorkflowVersion({ graph: g }, deps()).errors.filter(
      (e) => e.code === 'INVALID_TEMPLATE',
    );
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
  it('allows earlier step outputs in templates and conditions', () => {
    const g = good();
    g.nodes[1].config = {
      action: 'notify.email',
      subject: 's',
      body: 'Task {{steps.start.taskId}}',
    };
    expect(codes(g)).not.toContain('INVALID_TEMPLATE');
  });
  it('catches malformed templates (injection attempts)', () => {
    const g = good();
    g.nodes[1].config = {
      action: 'notify.email',
      subject: 's',
      body: '{{constructor.constructor("x")()}}',
    };
    expect(codes(g)).toContain('INVALID_TEMPLATE');
  });
  it('rejects an author who lacks the permission an action needs (no privilege escalation through automation)', () => {
    const r = validateWorkflowVersion(
      { graph: good() },
      deps({ authorPermissions: ['crm:task_manage'] }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.errors.find((e) => e.code === 'MISSING_PERMISSION')?.message,
    ).toContain('workflow:send_messages');
  });
  it('skips the permission check only when explicitly told to (re-validation)', () => {
    expect(
      validateWorkflowVersion(
        { graph: good() },
        deps({ authorPermissions: null }),
      ).ok,
    ).toBe(true);
  });
  it('rejects an unknown action and an invalid retry policy', () => {
    const g = good();
    g.nodes[1].config = { action: 'db.run_sql', sql: 'DROP TABLE x' };
    expect(codes(g)).toContain('UNKNOWN_ACTION');
    expect(codes(good(), deps(), { maxAttempts: 0 })).toContain(
      'INVALID_RETRY_POLICY',
    );
  });
  it('checks the fields an approval, wait and escalation refer to', () => {
    const g: WorkflowGraph = {
      nodes: [
        {
          id: 'start',
          type: 'TRIGGER',
          config: { event: 'payment.succeeded' },
        },
        {
          id: 'ap',
          type: 'APPROVAL',
          config: {
            approvalType: 'X',
            timeoutMs: 1000,
            amountField: 'nope.amount',
          },
        },
        {
          id: 'w',
          type: 'WAIT',
          config: { until: 'not.an_event', timeoutMs: 1000 },
        },
        { id: 'done', type: 'END' },
        { id: 'no', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'ap' },
        { from: 'ap', to: 'w', label: 'approved' },
        { from: 'ap', to: 'no', label: 'rejected' },
        { from: 'w', to: 'done' },
      ],
    };
    const c = codes(g);
    expect(c).toContain('INVALID_FIELD');
    expect(c).toContain('UNKNOWN_TRIGGER');
  });
  it('validates actions inside escalation levels, and their permissions', () => {
    const g: WorkflowGraph = {
      nodes: [
        {
          id: 'start',
          type: 'TRIGGER',
          config: { event: 'support_ticket.created' },
        },
        {
          id: 'esc',
          type: 'ESCALATION',
          config: {
            steps: [
              {
                afterMs: 1000,
                action: 'task.create',
                config: {
                  title: 't',
                  assignTo: { mode: 'STAFF', staffId: 's' },
                },
              },
              { afterMs: 2000, action: 'ghost' },
            ],
          },
        },
        { id: 'done', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'esc' },
        { from: 'esc', to: 'done' },
      ],
    };
    expect(codes(g)).toContain('UNKNOWN_ACTION');
    const ok = JSON.parse(JSON.stringify(g)) as WorkflowGraph;
    (ok.nodes[1].config as { steps: unknown[] }).steps.pop();
    expect(
      validateWorkflowVersion(
        { graph: ok },
        deps({ authorPermissions: [] }),
      ).errors.map((e) => e.code),
    ).toContain('MISSING_PERMISSION');
    expect(validateWorkflowVersion({ graph: ok }, deps()).ok).toBe(true);
  });
  it('warns, but does not fail, when a workflow does nothing', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'TRIGGER', config: { event: 'lead.created' } },
        { id: 'done', type: 'END' },
      ],
      edges: [{ from: 'start', to: 'done' }],
    };
    const r = validateWorkflowVersion({ graph: g }, deps());
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('NO_ACTIONS');
  });
  it('survives garbage input without throwing', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      5,
      [],
      {},
      { nodes: 'no', edges: 1 },
    ]) {
      expect(() =>
        validateWorkflowVersion({ graph: bad }, deps()),
      ).not.toThrow();
      expect(validateWorkflowVersion({ graph: bad }, deps()).ok).toBe(false);
    }
  });
});
