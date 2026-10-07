/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument --
   test doubles: the in-memory Prisma stand-in is deliberately loosely typed, and the
   spec asserts on jest.fn properties of the action objects. */
import { Prisma } from '@prisma/client';
import { ActionContext, WorkflowAction } from './actions/action.types';
import { WorkflowGraph } from './engine/graph';
import { ActionError } from './engine/retry';
import { WorkflowExecutorService } from './workflow-executor.service';

type Row = Record<string, any>;

/** A tiny in-memory stand-in for the handful of Prisma calls the executor makes. */
function makeDb(
  graph: WorkflowGraph,
  exOverrides: Row = {},
  versionOverrides: Row = {},
) {
  const executions = new Map<string, Row>();
  const steps = new Map<string, Row>();
  const deadLetters: Row[] = [];
  const approvalRequests = new Map<string, Row>();
  const unwrap = (v: unknown) => (v === Prisma.DbNull ? null : v);

  executions.set('ex1', {
    id: 'ex1',
    workflowId: 'wf1',
    versionId: 'v1',
    versionNo: 1,
    companyId: 'co-A',
    branchId: null,
    eventId: 'ev1',
    executionKey: 'k',
    mode: 'LIVE',
    status: 'RUNNING',
    currentNodeId: 'start',
    context: {
      customer: { id: 'c1' },
      booking: { totalAmount: 900000, reference: 'B1' },
      event: { id: 'ev1', entityId: 'b1' },
      steps: {},
    },
    waitingFor: null,
    nextRunAt: null,
    chain: { workflowChain: ['wf1'], eventChain: ['ev1'] },
    correlationId: 'corr',
    entityType: 'Booking',
    entityId: 'b1',
    error: null,
    ...exOverrides,
  });
  const version = {
    id: 'v1',
    version: 1,
    graph,
    retryPolicy: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      factor: 2,
      maxDelayMs: 60_000,
    },
    ...versionOverrides,
  };

  const matches = (row: Row, where: Row): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    if (typeof where.status === 'string' && row.status !== where.status)
      return false;
    if (where.OR) {
      const ok = where.OR.some((o: Row) =>
        o.nextRunAt === null
          ? row.nextRunAt === null
          : o.nextRunAt?.lte
            ? row.nextRunAt && row.nextRunAt <= o.nextRunAt.lte
            : false,
      );
      if (!ok) return false;
    }
    return true;
  };

  const prisma = {
    workflowExecution: {
      updateMany: jest.fn(({ where, data }: Row) => {
        let count = 0;
        for (const row of executions.values())
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        return Promise.resolve({ count });
      }),
      findUnique: jest.fn(({ where }: Row) => {
        const row = executions.get(where.id);
        return Promise.resolve(
          row
            ? {
                ...row,
                workflow: {
                  id: 'wf1',
                  name: 'Test flow',
                  ownerIdentityId: 'owner1',
                  createdByIdentityId: 'owner1',
                },
              }
            : null,
        );
      }),
      update: jest.fn(({ where, data }: Row) => {
        const row = executions.get(where.id) as Row;
        for (const [k, v] of Object.entries(data)) row[k] = unwrap(v);
        return Promise.resolve(row);
      }),
    },
    workflowExecutionStep: {
      findUnique: jest.fn(({ where }: Row) =>
        Promise.resolve(
          steps.get(
            `${where.executionId_nodeId.executionId}:${where.executionId_nodeId.nodeId}`,
          ) ?? null,
        ),
      ),
      upsert: jest.fn(({ where, create, update }: Row) => {
        const key = `${where.executionId_nodeId.executionId}:${where.executionId_nodeId.nodeId}`;
        const row = steps.has(key)
          ? Object.assign(steps.get(key) as Row, update)
          : { id: key, ...create };
        steps.set(key, row);
        return Promise.resolve(row);
      }),
    },
    workflowVersion: { findUnique: jest.fn(() => Promise.resolve(version)) },
    workflowDeadLetter: {
      create: jest.fn(({ data }: Row) => {
        deadLetters.push(data);
        return Promise.resolve(data);
      }),
    },
    approvalRequest: {
      findFirst: jest.fn(({ where }: Row) =>
        Promise.resolve(approvalRequests.get(where.id) ?? null),
      ),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return {
    prisma,
    executions,
    steps,
    deadLetters,
    approvalRequests,
    ex: () => executions.get('ex1') as Row,
  };
}

const action = (key: string, over: Partial<WorkflowAction> = {}) => {
  const run = jest.fn((ctx: ActionContext) =>
    Promise.resolve({ done: ctx.nodeId }),
  );
  const mock = jest.fn(() => ({ mocked: true }));
  const a: WorkflowAction = {
    key,
    label: key,
    sideEffect: 'NOTIFY',
    requiredPermissions: [],
    validate: () => [],
    run,
    mock,
    ...over,
  };
  return { a, run, mock };
};

function build(
  graph: WorkflowGraph,
  opts: {
    actions?: WorkflowAction[];
    ex?: Row;
    version?: Row;
    rateAllowed?: boolean;
  } = {},
) {
  const db = makeDb(graph, opts.ex, opts.version);
  const map = new Map((opts.actions ?? []).map((a) => [a.key, a]));
  const registry = { get: (k: string) => map.get(k) };
  const approvals = {
    createRequest: jest.fn(() => Promise.resolve({ id: 'ap1' })),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const rate = {
    consume: jest.fn(() =>
      Promise.resolve(
        opts.rateAllowed === false
          ? { allowed: false, retryAfterMs: 30_000 }
          : { allowed: true, retryAfterMs: 0 },
      ),
    ),
  };
  const svc = new WorkflowExecutorService(
    db.prisma as never,
    registry as never,
    approvals as never,
    audit as never,
    rate as never,
  );
  /** Pretend time has passed: make the execution due now. */
  const due = () => {
    db.ex().nextRunAt = new Date(0);
  };
  return { ...db, svc, approvals, audit, rate, due };
}

const linear = (...mid: WorkflowGraph['nodes']): WorkflowGraph => {
  const nodes: WorkflowGraph['nodes'] = [
    { id: 'start', type: 'TRIGGER' },
    ...mid,
    { id: 'done', type: 'END' },
  ];
  const edges = nodes
    .slice(0, -1)
    .map((n, i) => ({ from: n.id, to: nodes[i + 1].id }));
  return { nodes, edges };
};
const act = (
  id: string,
  a = 'notify.email',
  extra: Row = {},
): WorkflowGraph['nodes'][number] => ({
  id,
  type: 'ACTION',
  config: { action: a, ...extra },
});

describe('WorkflowExecutorService — normal flow', () => {
  it("runs a workflow to completion, recording every step and each action's output", async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('COMPLETED');
    expect(t.ex().finishedAt).toBeInstanceOf(Date);
    expect(mail.run).toHaveBeenCalledTimes(1);
    expect([...t.steps.values()].map((s) => [s.nodeId, s.status])).toEqual([
      ['start', 'SUCCEEDED'],
      ['mail', 'SUCCEEDED'],
      ['done', 'SUCCEEDED'],
    ]);
    expect(t.ex().context.steps.mail).toEqual({ done: 'mail' });
  });

  it("gives each action a stable per-step idempotency key and the execution's correlation id and chain", async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await t.svc.advance('ex1');
    const ctx = mail.run.mock.calls[0][0];
    expect(ctx.idempotencyKey).toBe('ex:ex1:node:mail');
    expect(ctx.correlationId).toBe('corr');
    expect(ctx.chain).toEqual({ workflowChain: ['wf1'], eventChain: ['ev1'] });
    expect(ctx.companyId).toBe('co-A');
  });

  it('routes on a condition and records its trace', async () => {
    const big = act('big', 'notify.email');
    const small = act('small', 'notify.email');
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'TRIGGER' },
        {
          id: 'c',
          type: 'CONDITION',
          config: {
            condition: {
              field: 'booking.totalAmount',
              op: 'gte',
              value: 500000,
            },
          },
        },
        big,
        small,
        { id: 'done', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'c' },
        { from: 'c', to: 'big', label: 'true' },
        { from: 'c', to: 'small', label: 'false' },
        { from: 'big', to: 'done' },
        { from: 'small', to: 'done' },
      ],
    };
    const a = action('notify.email');
    const t = build(g, { actions: [a.a] });
    await t.svc.advance('ex1');
    expect(a.run.mock.calls.map((c) => c[0].nodeId)).toEqual(['big']);
    expect(t.steps.get('ex1:c')?.trace[0]).toMatchObject({
      field: 'booking.totalAmount',
      result: true,
    });
  });

  it('never re-runs a step that already succeeded (crash after the step, before moving on)', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      ex: { currentNodeId: 'mail' },
    });
    t.steps.set('ex1:mail', {
      executionId: 'ex1',
      nodeId: 'mail',
      status: 'SUCCEEDED',
      attempts: 1,
      output: { done: 'mail' },
    });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
    expect(t.ex().status).toBe('COMPLETED');
  });

  it('advancing an already-finished execution does nothing', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      ex: { status: 'COMPLETED' },
    });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
  });
});

describe('WorkflowExecutorService — leases (safe with several workers)', () => {
  it('does not touch an execution another worker has leased', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      ex: { status: 'RUNNING', nextRunAt: new Date(Date.now() + 60_000) },
    });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
  });
  it('a worker that was handed an execution by the scheduler (already leased) runs it', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      ex: { status: 'RUNNING', nextRunAt: new Date(Date.now() + 60_000) },
    });
    await t.svc.advance('ex1', { leased: true });
    expect(mail.run).toHaveBeenCalledTimes(1);
  });
  it('two workers racing for the same execution run it once', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await Promise.all([t.svc.advance('ex1'), t.svc.advance('ex1')]);
    expect(mail.run).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowExecutorService — failures, retries and the dead-letter queue', () => {
  it('a retryable failure waits and retries with the same idempotency key', async () => {
    let calls = 0;
    const mail = action('notify.email', {
      run: jest.fn(() =>
        ++calls === 1
          ? Promise.reject(new ActionError('provider timeout', 'RETRYABLE'))
          : Promise.resolve({ ok: true }),
      ),
    });
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('WAITING');
    expect(t.ex().waitingFor).toMatchObject({ type: 'RETRY', attempt: 1 });
    expect(t.ex().nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(t.steps.get('ex1:mail')).toMatchObject({
      status: 'RETRYING',
      attempts: 1,
    });

    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('COMPLETED');
    const keys = (mail.a.run as jest.Mock).mock.calls.map(
      (c: [ActionContext]) => c[0].idempotencyKey,
    );
    expect(keys).toEqual(['ex:ex1:node:mail', 'ex:ex1:node:mail']);
  });

  it('gives up after the attempt cap and parks the execution in the dead-letter queue, with the reason', async () => {
    const mail = action('notify.email', {
      run: jest.fn(() =>
        Promise.reject(
          new ActionError('still down', 'RETRYABLE', 'PROVIDER_FAILED'),
        ),
      ),
    });
    const t = build(linear(act('mail')), { actions: [mail.a] });
    for (let i = 0; i < 5; i++) {
      await t.svc.advance('ex1');
      t.due();
    }
    expect(mail.a.run).toHaveBeenCalledTimes(3);
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters).toHaveLength(1);
    expect(t.deadLetters[0]).toMatchObject({
      executionId: 'ex1',
      nodeId: 'mail',
      reason: 'PROVIDER_FAILED',
      companyId: 'co-A',
      correlationId: 'corr',
    });
    expect(t.deadLetters[0].error).toContain('still down');
  });

  it('a permanent error is dead-lettered immediately, without a retry', async () => {
    const mail = action('notify.email', {
      run: jest.fn(() =>
        Promise.reject(
          new ActionError('invalid recipient', 'PERMANENT', 'BAD_INPUT'),
        ),
      ),
    });
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await t.svc.advance('ex1');
    expect(mail.a.run).toHaveBeenCalledTimes(1);
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('BAD_INPUT');
  });

  it('NEVER retries a financial action automatically, even for a "retryable" error', async () => {
    const pay = action('payment.charge', {
      sideEffect: 'FINANCIAL',
      run: jest.fn(() =>
        Promise.reject(new ActionError('gateway timeout', 'RETRYABLE')),
      ),
    });
    const t = build(linear(act('pay', 'payment.charge')), { actions: [pay.a] });
    await t.svc.advance('ex1');
    t.due();
    await t.svc.advance('ex1');
    expect(pay.a.run).toHaveBeenCalledTimes(1);
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].error).toContain('never retried automatically');
  });

  it('an unknown action is a dead letter, not a crash', async () => {
    const t = build(linear(act('x', 'does.not.exist')), { actions: [] });
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('UNKNOWN_ACTION');
  });

  it('a step missing from the pinned version is a dead letter', async () => {
    const t = build(linear(), { ex: { currentNodeId: 'ghost' } });
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('GRAPH');
  });

  it('an engine fault leaves the execution alive and looks again shortly (nothing is lost)', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), { actions: [mail.a] });
    t.prisma.workflowExecutionStep.upsert.mockRejectedValueOnce(
      new Error('db blip'),
    );
    await t.svc.advance('ex1');
    expect(['WAITING', 'RUNNING']).toContain(t.ex().status);
    expect(t.ex().error).toContain('db blip');
    expect(t.ex().status).not.toBe('DEAD_LETTERED');
  });

  it('audits action execution and failure', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), { actions: [mail.a] });
    await t.svc.advance('ex1');
    const actions = (
      t.audit.record.mock.calls as unknown as [{ action: string }][]
    ).map((c) => c[0].action);
    expect(actions).toContain('workflow.action_executed');
    expect(actions).toContain('workflow.execution_completed');
  });
});

describe('WorkflowExecutorService — test mode', () => {
  it('uses mocks and never runs the real action', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      ex: { mode: 'TEST' },
    });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
    expect(mail.mock).toHaveBeenCalled();
    expect(t.steps.get('ex1:mail')).toMatchObject({
      mocked: true,
      status: 'SUCCEEDED',
    });
    expect(t.ex().status).toBe('COMPLETED');
  });
  it('skips delays, waits and approvals (assumed granted) and creates no real approval request', async () => {
    const g = linear(
      { id: 'd', type: 'DELAY', config: { durationMs: 86_400_000 } },
      {
        id: 'w',
        type: 'WAIT',
        config: { until: 'payment.succeeded', timeoutMs: 1000 },
      },
      {
        id: 'ap',
        type: 'APPROVAL',
        config: { approvalType: 'X', timeoutMs: 1000 },
      },
    );
    g.edges = g.edges.map((e) =>
      e.from === 'ap' ? { ...e, label: 'approved' as const } : e,
    );
    g.nodes.push({ id: 'no', type: 'END' });
    g.edges.push({ from: 'ap', to: 'no', label: 'rejected' });
    const t = build(g, { ex: { mode: 'TEST' } });
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('COMPLETED');
    expect(t.approvals.createRequest).not.toHaveBeenCalled();
  });
});

describe('WorkflowExecutorService — rate limits', () => {
  it('defers (does not drop or fail) a message when the rate limit is hit, using no attempt', async () => {
    const mail = action('notify.email');
    const t = build(linear(act('mail')), {
      actions: [mail.a],
      rateAllowed: false,
    });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
    expect(t.ex().status).toBe('WAITING');
    expect(t.ex().waitingFor).toMatchObject({
      type: 'RATE_LIMIT',
      limit: 'messages.minute',
    });
    expect(t.steps.get('ex1:mail')).toBeUndefined();
    expect(t.deadLetters).toHaveLength(0);
  });
  it('does not rate-limit internal (no side effect) actions or test runs', async () => {
    const note = action('audit.note', { sideEffect: 'NONE' });
    const t = build(linear(act('n', 'audit.note')), { actions: [note.a] });
    await t.svc.advance('ex1');
    expect(t.rate.consume).not.toHaveBeenCalled();
  });
});

describe('WorkflowExecutorService — delay, wait and approval', () => {
  it('a delay parks the execution until its time, then continues', async () => {
    const mail = action('notify.email');
    const t = build(
      linear(
        { id: 'd', type: 'DELAY', config: { durationMs: 3_600_000 } },
        act('mail'),
      ),
      { actions: [mail.a] },
    );
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('WAITING');
    expect(t.ex().waitingFor).toEqual({ type: 'DELAY' });
    expect(t.ex().nextRunAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    expect(mail.run).not.toHaveBeenCalled();
    t.due();
    await t.svc.advance('ex1');
    expect(mail.run).toHaveBeenCalledTimes(1);
    expect(t.ex().status).toBe('COMPLETED');
  });

  it('a wait resumes when the awaited event has arrived', async () => {
    const mail = action('notify.email');
    const t = build(
      linear(
        {
          id: 'w',
          type: 'WAIT',
          config: { until: 'payment.succeeded', timeoutMs: 3_600_000 },
        },
        act('mail'),
      ),
      { actions: [mail.a] },
    );
    await t.svc.advance('ex1');
    expect(t.ex().waitingFor).toMatchObject({
      type: 'EVENT',
      event: 'payment.succeeded',
    });
    // the dispatcher marks it satisfied and makes it due
    t.ex().waitingFor = { ...t.ex().waitingFor, satisfiedBy: 'ev9' };
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('COMPLETED');
    expect(mail.run).toHaveBeenCalledTimes(1);
    expect(t.ex().context.steps.w).toEqual({ satisfiedBy: 'ev9' });
  });

  it('a wait that times out follows its timeout connection when there is one', async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'TRIGGER' },
        {
          id: 'w',
          type: 'WAIT',
          config: { until: 'payment.succeeded', timeoutMs: 1000 },
        },
        { id: 'ok', type: 'END' },
        { id: 'late', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'w' },
        { from: 'w', to: 'ok' },
        { from: 'w', to: 'late', label: 'timeout' },
      ],
    };
    const t = build(g);
    await t.svc.advance('ex1');
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('COMPLETED');
    expect(t.ex().currentNodeId).toBe('late');
  });

  it('a wait that times out with no timeout connection is a dead letter, not an endless wait', async () => {
    const t = build(
      linear({
        id: 'w',
        type: 'WAIT',
        config: { until: 'payment.succeeded', timeoutMs: 1000 },
      }),
    );
    await t.svc.advance('ex1');
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('WAIT_TIMEOUT');
  });

  const approvalGraph = (): WorkflowGraph => ({
    nodes: [
      { id: 'start', type: 'TRIGGER' },
      {
        id: 'ap',
        type: 'APPROVAL',
        config: {
          approvalType: 'REFUND',
          timeoutMs: 3_600_000,
          amountField: 'booking.totalAmount',
        },
      },
      { id: 'yes', type: 'END' },
      { id: 'no', type: 'END' },
    ],
    edges: [
      { from: 'start', to: 'ap' },
      { from: 'ap', to: 'yes', label: 'approved' },
      { from: 'ap', to: 'no', label: 'rejected' },
    ],
  });

  it('requests approval ONCE through the existing approval engine, as the workflow owner, and waits', async () => {
    const t = build(approvalGraph());
    await t.svc.advance('ex1');
    expect(t.approvals.createRequest).toHaveBeenCalledTimes(1);
    expect(t.approvals.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW:REFUND',
        amount: 900000,
        requestedByIdentityId: 'owner1',
        companyId: 'co-A',
        entityType: 'WorkflowExecution',
        entityId: 'ex1',
      }),
    );
    expect(t.ex().status).toBe('WAITING');
    t.due();
    await t.svc.advance('ex1'); // still undecided: keeps waiting, does NOT raise a second request
    expect(t.approvals.createRequest).toHaveBeenCalledTimes(1);
    expect(t.ex().status).toBe('WAITING');
  });

  it('follows the approved path only once a person has approved', async () => {
    const t = build(approvalGraph());
    await t.svc.advance('ex1');
    t.approvalRequests.set('ap1', { status: 'APPROVED' });
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().currentNodeId).toBe('yes');
    expect(t.ex().status).toBe('COMPLETED');
  });

  it('follows the rejected path when rejected', async () => {
    const t = build(approvalGraph());
    await t.svc.advance('ex1');
    t.approvalRequests.set('ap1', { status: 'REJECTED' });
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().currentNodeId).toBe('no');
  });

  it('an approval nobody decides in time is a dead letter (it is never assumed approved)', async () => {
    const t = build(approvalGraph());
    await t.svc.advance('ex1');
    const step = t.steps.get('ex1:ap') as Row;
    step.output = {
      ...step.output,
      deadline: new Date(Date.now() - 1000).toISOString(),
    };
    t.due();
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('APPROVAL_TIMEOUT');
  });

  it("only looks at approvals belonging to the execution's own company", async () => {
    const t = build(approvalGraph());
    await t.svc.advance('ex1');
    t.due();
    await t.svc.advance('ex1');
    expect(t.prisma.approvalRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ap1', companyId: 'co-A' } }),
    );
  });

  it('cannot request an approval without an owner to request it as', async () => {
    const t = build(approvalGraph());
    t.prisma.workflowExecution.findUnique.mockImplementation(() =>
      Promise.resolve({
        ...t.ex(),
        workflow: {
          id: 'wf1',
          name: 'x',
          ownerIdentityId: null,
          createdByIdentityId: null,
        },
      } as never),
    );
    await t.svc.advance('ex1');
    expect(t.ex().status).toBe('DEAD_LETTERED');
    expect(t.deadLetters[0].reason).toBe('NO_REQUESTER');
    expect(t.approvals.createRequest).not.toHaveBeenCalled();
  });
});

describe('WorkflowExecutorService — escalation', () => {
  const escGraph = (extra: Row = {}): WorkflowGraph => ({
    nodes: [
      { id: 'start', type: 'TRIGGER' },
      {
        id: 'esc',
        type: 'ESCALATION',
        config: {
          steps: [
            { afterMs: 1000, action: 'notify.email', config: { n: 1 } },
            { afterMs: 2000, action: 'notify.email', config: { n: 2 } },
          ],
          ...extra,
        },
      },
      { id: 'done', type: 'END' },
    ],
    edges: [
      { from: 'start', to: 'esc' },
      { from: 'esc', to: 'done' },
    ],
  });

  it('fires each level in turn, at its own time, with a distinct idempotency key per level', async () => {
    const mail = action('notify.email');
    const t = build(escGraph(), { actions: [mail.a] });
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled(); // first level is 1s away
    expect(t.ex().waitingFor).toMatchObject({ type: 'ESCALATION', level: 0 });
    t.due();
    await t.svc.advance('ex1');
    expect(mail.run).toHaveBeenCalledTimes(1);
    expect(t.ex().waitingFor).toMatchObject({ type: 'ESCALATION', level: 1 });
    t.due();
    await t.svc.advance('ex1');
    expect(mail.run).toHaveBeenCalledTimes(2);
    expect(t.ex().status).toBe('COMPLETED');
    const keys = mail.run.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys).toEqual(['ex:ex1:node:esc:L0', 'ex:ex1:node:esc:L1']);
  });

  it('stops early when the stop event arrives, firing no further level', async () => {
    const mail = action('notify.email');
    const t = build(escGraph({ stopOnEvent: 'support_ticket.created' }), {
      actions: [mail.a],
    });
    await t.svc.advance('ex1');
    t.ex().waitingFor = { ...t.ex().waitingFor, satisfiedBy: 'evX' };
    t.due();
    await t.svc.advance('ex1');
    expect(mail.run).not.toHaveBeenCalled();
    expect(t.ex().status).toBe('COMPLETED');
  });

  it('a level that keeps failing is capped and dead-lettered — it cannot retry forever', async () => {
    const mail = action('notify.email', {
      run: jest.fn(() => Promise.reject(new ActionError('down', 'RETRYABLE'))),
    });
    const t = build(escGraph(), { actions: [mail.a] });
    for (let i = 0; i < 12; i++) {
      await t.svc.advance('ex1');
      t.due();
    }
    expect(mail.a.run).toHaveBeenCalledTimes(3);
    expect(t.ex().status).toBe('DEAD_LETTERED');
  });
});
