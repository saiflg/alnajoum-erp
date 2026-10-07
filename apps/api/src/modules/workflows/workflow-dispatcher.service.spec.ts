/* eslint-disable @typescript-eslint/no-unsafe-argument -- loosely typed Prisma test doubles */
import { Prisma } from '@prisma/client';
import { WorkflowGraph } from './engine/graph';
import { WorkflowDispatcherService } from './workflow-dispatcher.service';

type Row = Record<string, any>;

const graph = (condition?: unknown): WorkflowGraph => ({
  nodes: [
    {
      id: 'start',
      type: 'TRIGGER',
      config: {
        event: 'payment.succeeded',
        ...(condition ? { condition } : {}),
      },
    },
    { id: 'done', type: 'END' },
  ],
  edges: [{ from: 'start', to: 'done' }],
});

const event = (over: Row = {}): Row => ({
  id: 'ev1',
  type: 'payment.succeeded',
  source: 'payments',
  companyId: 'co-A',
  branchId: null,
  correlationId: 'corr1',
  entityType: 'Invoice',
  entityId: 'inv1',
  payload: {
    payment: { amount: 750000, currency: 'NGN' },
    customer: { id: 'c1' },
  },
  chain: { workflowChain: [], eventChain: [] },
  status: 'PENDING',
  occurredAt: new Date('2026-10-07T10:00:00Z'),
  ...over,
});

function setup(
  opts: {
    ev?: Row;
    defs?: Row[];
    graph?: WorkflowGraph;
    rateAllowed?: boolean;
    waiting?: Row[];
  } = {},
) {
  const ev = opts.ev ?? event();
  const defs = opts.defs ?? [
    { id: 'wfA', name: 'Paid', branchId: null, activeVersionId: 'vA' },
  ];
  const created: Row[] = [];
  const prisma = {
    workflowEvent: {
      findUnique: jest.fn(() => Promise.resolve(ev)),
      update: jest.fn(() => Promise.resolve({})),
    },
    workflowDefinition: { findMany: jest.fn(() => Promise.resolve(defs)) },
    workflowVersion: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 'vA', version: 2, graph: opts.graph ?? graph() }),
      ),
    },
    workflowExecution: {
      create: jest.fn(({ data }: Row) => {
        created.push(data);
        return Promise.resolve({ id: `ex${created.length}`, ...data });
      }),
      findMany: jest.fn(() => Promise.resolve(opts.waiting ?? [])),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    workflowDeadLetter: { create: jest.fn(() => Promise.resolve({})) },
  };
  const executor = { advance: jest.fn(() => Promise.resolve()) };
  const rate = {
    consume: jest.fn(() =>
      Promise.resolve(
        opts.rateAllowed === false
          ? { allowed: false, retryAfterMs: 20_000 }
          : { allowed: true, retryAfterMs: 0 },
      ),
    ),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const d = new WorkflowDispatcherService(
    prisma as never,
    executor as never,
    rate as never,
    audit as never,
  );
  return { d, prisma, executor, rate, audit, created };
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'x',
  });

describe('WorkflowDispatcherService.dispatch — matching', () => {
  it("starts an ACTIVE workflow of the event's own company, pinned to its active version", async () => {
    const t = setup();
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(1);
    const where = (
      t.prisma.workflowDefinition.findMany.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(where).toMatchObject({
      companyId: 'co-A',
      status: 'ACTIVE',
      triggerEvent: 'payment.succeeded',
    });
    expect(t.created[0]).toMatchObject({
      workflowId: 'wfA',
      versionId: 'vA',
      versionNo: 2,
      companyId: 'co-A',
      eventId: 'ev1',
      mode: 'LIVE',
      correlationId: 'corr1',
      executionKey: 'wf:wfA:ev:ev1',
    });
    expect(t.created[0].chain).toEqual({
      workflowChain: ['wfA'],
      eventChain: ['ev1'],
    });
    expect(t.executor.advance).toHaveBeenCalledWith('ex1');
  });

  it('puts the payload at the top level of the context, with a reserved event block', async () => {
    const t = setup();
    await t.d.dispatch('ev1');
    expect(t.created[0].context).toMatchObject({
      payment: { amount: 750000 },
      customer: { id: 'c1' },
      event: { id: 'ev1', type: 'payment.succeeded', entityId: 'inv1' },
      steps: {},
    });
  });

  it("only matches a branch-scoped workflow to that branch's events (or company-wide ones)", async () => {
    const t = setup({ ev: event({ branchId: 'br-1' }) });
    await t.d.dispatch('ev1');
    const where = (
      t.prisma.workflowDefinition.findMany.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(where.OR).toEqual([{ branchId: null }, { branchId: 'br-1' }]);
  });

  it('an event with no company starts nothing (no tenant to run for) and is still marked processed', async () => {
    const t = setup({ ev: event({ companyId: null }) });
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(0);
    expect(t.prisma.workflowDefinition.findMany).not.toHaveBeenCalled();
    expect(t.prisma.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED' }),
      }),
    );
  });

  it('skips an event that was already processed', async () => {
    const t = setup({ ev: event({ status: 'PROCESSED' }) });
    expect(await t.d.dispatch('ev1')).toEqual({ started: 0, woken: 0 });
    expect(t.prisma.workflowDefinition.findMany).not.toHaveBeenCalled();
  });

  it('does not start when the trigger condition is not met, and records no execution', async () => {
    const t = setup({
      graph: graph({ field: 'payment.amount', op: 'gte', value: 1_000_000 }),
    });
    expect((await t.d.dispatch('ev1')).started).toBe(0);
    expect(t.created).toHaveLength(0);
  });

  it('starts when the trigger condition is met', async () => {
    const t = setup({
      graph: graph({ field: 'payment.amount', op: 'gte', value: 500_000 }),
    });
    expect((await t.d.dispatch('ev1')).started).toBe(1);
  });

  it('an invalid trigger condition is skipped safely (never starts, never crashes dispatch)', async () => {
    const t = setup({
      graph: graph({ field: 'a', op: 'matches', value: 'x' }),
    });
    expect((await t.d.dispatch('ev1')).started).toBe(0);
  });
});

describe('WorkflowDispatcherService.dispatch — idempotency and protection', () => {
  it('a replayed event does not run the workflow twice (unique execution key)', async () => {
    const t = setup();
    t.prisma.workflowExecution.create.mockRejectedValueOnce(p2002());
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(0);
    expect(t.executor.advance).not.toHaveBeenCalled();
    expect(t.prisma.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED' }),
      }),
    );
  });

  it('stops A → B → A: records a visible, dead-lettered execution instead of running', async () => {
    const t = setup({
      ev: event({
        chain: { workflowChain: ['wfA', 'wfB'], eventChain: ['e0', 'e1'] },
      }),
    });
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(0);
    expect(t.executor.advance).not.toHaveBeenCalled();
    expect(t.created[0]).toMatchObject({
      status: 'DEAD_LETTERED',
      workflowId: 'wfA',
    });
    expect(t.prisma.workflowDeadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'LOOP_CYCLE',
          companyId: 'co-A',
        }),
      }),
    );
    expect(
      (t.audit.record.mock.calls as unknown as [{ action: string }][]).map(
        (c) => c[0].action,
      ),
    ).toContain('workflow.loop_prevented');
  });

  it('stops a cascade that is too deep', async () => {
    const chain = {
      workflowChain: ['w1', 'w2', 'w3', 'w4', 'w5'],
      eventChain: ['e1', 'e2', 'e3', 'e4', 'e5'],
    };
    const t = setup({ ev: event({ chain }) });
    await t.d.dispatch('ev1');
    expect(t.prisma.workflowDeadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'LOOP_MAX_DEPTH' }),
      }),
    );
  });

  it('defers (does not drop) an execution when the company is over its execution rate limit', async () => {
    const t = setup({ rateAllowed: false });
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(1);
    expect(t.created[0]).toMatchObject({
      status: 'WAITING',
      waitingFor: { type: 'RATE_LIMIT', limit: 'executions.minute' },
    });
    expect(t.created[0].nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(t.executor.advance).not.toHaveBeenCalled();
    expect(t.rate.consume).toHaveBeenCalledWith('co-A', 'executions.minute');
  });

  it('one failing workflow does not stop the others, and the event is marked FAILED for the recovery sweep', async () => {
    const t = setup({
      defs: [
        { id: 'wfA', name: 'A', branchId: null, activeVersionId: 'vA' },
        { id: 'wfB', name: 'B', branchId: null, activeVersionId: 'vA' },
      ],
    });
    t.prisma.workflowExecution.create.mockRejectedValueOnce(
      new Error('db blip'),
    );
    const r = await t.d.dispatch('ev1');
    expect(r.started).toBe(1);
    expect(t.prisma.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('db blip'),
        }),
      }),
    );
  });

  it('audits the start of each execution with the correlation id', async () => {
    const t = setup();
    await t.d.dispatch('ev1');
    const call = (t.audit.record.mock.calls as unknown as [Row][])
      .map((c) => c[0])
      .find((c) => c.action === 'workflow.execution_started');
    expect(call).toMatchObject({
      companyId: 'co-A',
      metadata: expect.objectContaining({
        correlationId: 'corr1',
        workflowId: 'wfA',
      }),
    });
  });
});

describe('WorkflowDispatcherService — waking waiting executions', () => {
  const waiter = (over: Row = {}) => ({
    id: 'w1',
    entityId: 'inv1',
    waitingFor: { type: 'EVENT', event: 'payment.succeeded' },
    ...over,
  });

  it('wakes executions waiting for this event, about the same entity, in the same company', async () => {
    const t = setup({ waiting: [waiter()], defs: [] });
    const r = await t.d.dispatch('ev1');
    expect(r.woken).toBe(1);
    const q = (
      t.prisma.workflowExecution.findMany.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(q).toMatchObject({
      companyId: 'co-A',
      status: 'WAITING',
      waitingFor: { path: ['event'], equals: 'payment.succeeded' },
    });
    expect(t.prisma.workflowExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          waitingFor: {
            type: 'EVENT',
            event: 'payment.succeeded',
            satisfiedBy: 'ev1',
          },
        }),
      }),
    );
    expect(t.executor.advance).toHaveBeenCalledWith('w1');
  });

  it('does not wake an execution waiting on a DIFFERENT entity', async () => {
    const t = setup({
      waiting: [waiter({ entityId: 'other-invoice' })],
      defs: [],
    });
    expect((await t.d.dispatch('ev1')).woken).toBe(0);
    expect(t.executor.advance).not.toHaveBeenCalled();
  });

  it('does not wake an execution about an entity when the event names none', async () => {
    const t = setup({
      ev: event({ entityId: null }),
      waiting: [waiter()],
      defs: [],
    });
    expect((await t.d.dispatch('ev1')).woken).toBe(0);
  });

  it('only advances an execution it actually claimed (another worker may have got there first)', async () => {
    const t = setup({ waiting: [waiter()], defs: [] });
    t.prisma.workflowExecution.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await t.d.dispatch('ev1')).woken).toBe(0);
    expect(t.executor.advance).not.toHaveBeenCalled();
  });
});
