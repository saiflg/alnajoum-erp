// The scheduler class uses @Cron; the real decorator is not needed (nor wanted) in a unit test.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { WorkflowGraph } from './engine/graph';
import { WorkflowSchedulerService } from './workflow-scheduler.service';

type Row = Record<string, any>;

const NOW = new Date('2026-10-07T13:30:00.000Z'); // 14:30 in Lagos
const schedGraph = (cfg: Row): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'TRIGGER', config: { schedule: cfg } },
    { id: 'done', type: 'END' },
  ],
  edges: [{ from: 'start', to: 'done' }],
});

function setup(
  opts: {
    defs?: Row[];
    graph?: WorkflowGraph;
    claimed?: { id: string }[];
    staleEvents?: { id: string }[];
    claimCount?: number;
  } = {},
) {
  const prisma = {
    workflowDefinition: {
      findMany: jest.fn(() => Promise.resolve(opts.defs ?? [])),
      updateMany: jest.fn(() =>
        Promise.resolve({ count: opts.claimCount ?? 1 }),
      ),
    },
    workflowVersion: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          graph: opts.graph ?? schedGraph({ frequency: 'DAILY', hour: 9 }),
        }),
      ),
    },
    workflowEvent: {
      findMany: jest.fn(() => Promise.resolve(opts.staleEvents ?? [])),
    },
    $queryRaw: jest.fn(() => Promise.resolve(opts.claimed ?? [])),
  };
  const executor = { advance: jest.fn(() => Promise.resolve()) };
  const dispatcher = {
    dispatch: jest.fn(() => Promise.resolve({ started: 0, woken: 0 })),
  };
  const bus = { publishSafe: jest.fn(() => Promise.resolve()) };
  const s = new WorkflowSchedulerService(
    prisma as never,
    executor as never,
    dispatcher as never,
    bus as never,
  );
  return { s, prisma, executor, dispatcher, bus };
}
const def = (over: Row = {}) => ({
  id: 'wfS',
  companyId: 'co-A',
  branchId: null,
  triggerEvent: 'schedule.wfs',
  activeVersionId: 'vS',
  scheduleLastFiredAt: null,
  ...over,
});

describe('schedule triggers', () => {
  it('fires a due schedule once, publishing a deduplicated event for the company', async () => {
    const t = setup({ defs: [def()] });
    const r = await t.s.tick(NOW);
    expect(r.schedulesFired).toBe(1);
    expect(t.bus.publishSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'schedule.wfs',
        source: 'scheduler',
        companyId: 'co-A',
        entityType: 'WorkflowDefinition',
        entityId: 'wfS',
        dedupeKey: 'schedule:wfS:2026-10-07T08:00:00.000Z',
      }),
    );
  });
  it('claims the window with a conditional update, so two instances cannot both fire it', async () => {
    const t = setup({ defs: [def()], claimCount: 0 }); // the other instance won
    const r = await t.s.tick(NOW);
    expect(r.schedulesFired).toBe(0);
    expect(t.bus.publishSafe).not.toHaveBeenCalled();
    const arg = (
      t.prisma.workflowDefinition.updateMany.mock.calls[0] as unknown as [
        { where: Row; data: Row },
      ]
    )[0];
    expect(arg.where.OR).toEqual([
      { scheduleLastFiredAt: null },
      { scheduleLastFiredAt: { lt: new Date('2026-10-07T08:00:00.000Z') } },
    ]);
  });
  it('does not fire a window that already fired', async () => {
    const t = setup({
      defs: [
        def({ scheduleLastFiredAt: new Date('2026-10-07T08:00:00.000Z') }),
      ],
    });
    expect((await t.s.tick(NOW)).schedulesFired).toBe(0);
    expect(t.prisma.workflowDefinition.updateMany).not.toHaveBeenCalled();
  });
  it('only looks at ACTIVE schedule workflows', async () => {
    const t = setup();
    await t.s.tick(NOW);
    expect(
      (
        t.prisma.workflowDefinition.findMany.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where,
    ).toMatchObject({
      status: 'ACTIVE',
      triggerEvent: { startsWith: 'schedule.' },
    });
  });
  it('after downtime it fires once for the latest window, not once per missed window', async () => {
    const t = setup({
      defs: [
        def({ scheduleLastFiredAt: new Date('2026-09-20T08:00:00.000Z') }),
      ],
    });
    expect((await t.s.tick(NOW)).schedulesFired).toBe(1);
    expect(t.bus.publishSafe).toHaveBeenCalledTimes(1);
  });
  it('ignores a workflow whose trigger has no schedule', async () => {
    const t = setup({
      defs: [def()],
      graph: {
        nodes: [
          { id: 'start', type: 'TRIGGER', config: { event: 'lead.created' } },
          { id: 'done', type: 'END' },
        ],
        edges: [{ from: 'start', to: 'done' }],
      },
    });
    expect((await t.s.tick(NOW)).schedulesFired).toBe(0);
  });
});

describe('due executions', () => {
  it('claims a batch with a lease (FOR UPDATE SKIP LOCKED) and runs each as already leased', async () => {
    const t = setup({ claimed: [{ id: 'a' }, { id: 'b' }] });
    const r = await t.s.tick(NOW);
    expect(r.executionsRun).toBe(2);
    expect(t.executor.advance).toHaveBeenCalledWith('a', { leased: true });
    expect(t.executor.advance).toHaveBeenCalledWith('b', { leased: true });
    const sql = (
      t.prisma.$queryRaw.mock.calls[0] as unknown as [string[]]
    )[0].join('?');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('LIMIT');
  });
  it('does nothing when nothing is due', async () => {
    const t = setup();
    expect((await t.s.tick(NOW)).executionsRun).toBe(0);
    expect(t.executor.advance).not.toHaveBeenCalled();
  });
});

describe('event recovery', () => {
  it('re-dispatches events that were stored but never processed (a crash between store and dispatch)', async () => {
    const t = setup({ staleEvents: [{ id: 'e1' }, { id: 'e2' }] });
    const r = await t.s.tick(NOW);
    expect(r.eventsRecovered).toBe(2);
    expect(t.dispatcher.dispatch).toHaveBeenCalledWith('e1');
    expect(t.dispatcher.dispatch).toHaveBeenCalledWith('e2');
  });
  it('only picks up events older than a grace period, so it does not race the normal dispatch', async () => {
    const t = setup();
    await t.s.tick(NOW);
    const where = (
      t.prisma.workflowEvent.findMany.mock.calls[0] as unknown as [
        { where: { OR: Row[] } },
      ]
    )[0].where;
    expect(where.OR[0]).toMatchObject({
      status: 'PENDING',
      createdAt: { lt: new Date(NOW.getTime() - 15_000) },
    });
  });
  it('one failing recovery does not stop the others', async () => {
    const t = setup({ staleEvents: [{ id: 'e1' }, { id: 'e2' }] });
    t.dispatcher.dispatch.mockRejectedValueOnce(new Error('boom'));
    await expect(t.s.tick(NOW)).resolves.toMatchObject({ eventsRecovered: 2 });
    expect(t.dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('the cron entry point', () => {
  it('does not overlap with itself in one process', async () => {
    const t = setup();
    let release: () => void = () => undefined;
    t.prisma.workflowDefinition.findMany.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r([]);
        }) as never,
    );
    const first = t.s.scheduled();
    await t.s.scheduled(); // second call while the first is still running -> returns immediately
    expect(t.prisma.workflowDefinition.findMany).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
  it('can be switched off with WORKFLOW_SCHEDULER_DISABLED', async () => {
    process.env.WORKFLOW_SCHEDULER_DISABLED = 'true';
    const t = setup();
    await t.s.scheduled();
    expect(t.prisma.workflowDefinition.findMany).not.toHaveBeenCalled();
    delete process.env.WORKFLOW_SCHEDULER_DISABLED;
  });
  it('a failing tick is logged, never thrown into the scheduler', async () => {
    const t = setup();
    t.prisma.workflowDefinition.findMany.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(t.s.scheduled()).resolves.toBeUndefined();
  });
});
