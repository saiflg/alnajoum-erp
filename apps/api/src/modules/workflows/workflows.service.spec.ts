import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { WorkflowGraph } from './engine/graph';
import { WorkflowsService } from './workflows.service';

type Row = Record<string, any>;

const user = (over: Partial<AuthContext> = {}): AuthContext => ({
  sub: 'id-1',
  type: 'STAFF',
  roles: ['COMPANY_ADMIN'],
  companyId: 'co-A',
  sessionId: null,
  permissions: [
    'workflow:send_messages',
    'workflow:create',
    'crm:task_manage',
    'crm:customer_360_view',
    'workflow:view',
  ],
  ...over,
});
const superAdmin = user({ roles: ['SUPER_ADMIN'], companyId: null });

const good = (): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'TRIGGER', config: { event: 'payment.succeeded' } },
    {
      id: 'mail',
      type: 'ACTION',
      config: {
        action: 'notify.email',
        subject: 'Paid',
        body: 'Thanks {{payment.amount}}',
      },
    },
    { id: 'done', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'mail' },
    { from: 'mail', to: 'done' },
  ],
});

function setup(
  opts: {
    def?: Row | null;
    version?: Row | null;
    scope?: Row;
    latestVersionRow?: Row;
  } = {},
) {
  const def =
    opts.def === null
      ? null
      : {
          id: 'wf1',
          companyId: 'co-A',
          name: 'Flow',
          status: 'DRAFT',
          latestVersion: 1,
          activeVersionId: null,
          branchId: null,
          ...opts.def,
        };
  const version =
    opts.version === null
      ? null
      : {
          id: 'v1',
          workflowId: 'wf1',
          version: 1,
          graph: good(),
          retryPolicy: null,
          isLocked: false,
          lockedAt: null,
          ...opts.version,
        };
  const prisma = {
    workflowDefinition: {
      findFirst: jest.fn(() => Promise.resolve(def)),
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(({ data }: Row) =>
        Promise.resolve({ ...data, status: 'DRAFT' }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    workflowVersion: {
      findUnique: jest.fn(() => Promise.resolve(version)),
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(() => Promise.resolve({})),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    workflowExecution: {
      findFirst: jest.fn(),
      findMany: jest.fn(() => Promise.resolve([])),
      count: jest.fn(() => Promise.resolve(0)),
      create: jest.fn(() => Promise.resolve({ id: 'exT' })),
      update: jest.fn(),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      findUnique: jest.fn(() => Promise.resolve({ status: 'COMPLETED' })),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    workflowDeadLetter: {
      findFirst: jest.fn(),
      findMany: jest.fn(() => Promise.resolve([])),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(() => Promise.resolve(0)),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    workflowEvent: {
      findFirst: jest.fn(),
      findMany: jest.fn(() => Promise.resolve([])),
      count: jest.fn(() => Promise.resolve(0)),
    },
    workflowExecutionStep: { updateMany: jest.fn() },
    branch: { findFirst: jest.fn(() => Promise.resolve({ id: 'br-1' })) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(() => Promise.resolve([{ avg_ms: null }])),
  };
  const actions = new Map<string, Row>([
    [
      'notify.email',
      {
        key: 'notify.email',
        label: 'Email',
        sideEffect: 'NOTIFY',
        requiredPermissions: ['workflow:send_messages'],
        validate: () => [],
      },
    ],
    [
      'payment.charge',
      {
        key: 'payment.charge',
        label: 'Charge',
        sideEffect: 'FINANCIAL',
        requiredPermissions: [],
        validate: () => [],
      },
    ],
  ]);
  const registry = {
    get: (k: string) => actions.get(k),
    keys: () => new Set(actions.keys()),
    list: () => [],
    info: () =>
      new Map([['notify.email', { label: 'Email', sideEffect: 'NOTIFY' }]]),
  };
  const executor = { advance: jest.fn(() => Promise.resolve()) };
  const scopes = {
    resolve: jest.fn(() =>
      Promise.resolve({
        companyId: 'co-A',
        branchId: undefined,
        branchLocked: false,
        description: 'x',
        ...opts.scope,
      }),
    ),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const svc = new WorkflowsService(
    prisma as never,
    registry as never,
    executor as never,
    scopes as never,
    audit as never,
  );
  return { svc, prisma, executor, scopes, audit };
}
const auditActions = (t: ReturnType<typeof setup>) =>
  (t.audit.record.mock.calls as unknown as [{ action: string }][]).map(
    (c) => c[0].action,
  );

describe('tenant isolation', () => {
  it("another company's workflow is a 404 — the lookup is bound to the caller's tenant", async () => {
    const t = setup({ def: null });
    await expect(t.svc.get(user(), 'wf-of-company-B')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const where = (
      t.prisma.workflowDefinition.findFirst.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(where).toMatchObject({ id: 'wf-of-company-B', companyId: 'co-A' });
  });
  it("every change path looks the workflow up by the caller's company", async () => {
    for (const run of [
      (s: WorkflowsService) =>
        s.saveVersion(user(), 'x', { graph: good() as never }),
      (s: WorkflowsService) => s.activate(user(), 'x'),
      (s: WorkflowsService) => s.test(user(), 'x', { payload: {} }),
      (s: WorkflowsService) => s.setStatus(user(), 'x', 'PAUSED', 'because'),
    ]) {
      const t = setup({ def: null });
      await expect(run(t.svc)).rejects.toBeInstanceOf(NotFoundException);
      const where = (
        t.prisma.workflowDefinition.findFirst.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where;
      expect(where.companyId).toBe('co-A');
    }
  });
  it('the super admin has no single company, so cannot create or change automation', async () => {
    const t = setup();
    await expect(
      t.svc.create(superAdmin, { name: 'Abc', graph: good() as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.activate(superAdmin, 'wf1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('an account with no company is refused', async () => {
    const t = setup();
    await expect(
      t.svc.create(user({ companyId: null }), {
        name: 'Abc',
        graph: good() as never,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('reads go through the scope service (tenant + branch lock); a branch-locked caller only sees company-wide or own-branch workflows', async () => {
    const t = setup({ scope: { branchId: 'br-9', branchLocked: true } });
    await t.svc.list(user({ roles: ['BRANCH_MANAGER'] }), {});
    const where = (
      t.prisma.workflowDefinition.findMany.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(where).toMatchObject({
      companyId: 'co-A',
      OR: [{ branchId: null }, { branchId: 'br-9' }],
    });
  });
  it("executions, dead letters, events and metrics are all scoped to the caller's company", async () => {
    const t = setup();
    await t.svc.listExecutions(user(), {});
    await t.svc.listDeadLetters(user(), {});
    await t.svc.listEvents(user());
    await t.svc.metrics(user());
    expect(
      (
        t.prisma.workflowExecution.findMany.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where.companyId,
    ).toBe('co-A');
    expect(
      (
        t.prisma.workflowDeadLetter.findMany.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where.companyId,
    ).toBe('co-A');
    expect(
      (
        t.prisma.workflowEvent.findMany.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where.companyId,
    ).toBe('co-A');
    for (const c of t.prisma.workflowExecution.groupBy.mock
      .calls as unknown as [{ where: Row }][])
      expect(c[0].where.companyId).toBe('co-A');
    for (const c of t.prisma.workflowDeadLetter.count.mock.calls as unknown as [
      { where: Row },
    ][])
      expect(c[0].where.companyId).toBe('co-A');
  });
  it('a cross-tenant execution or dead letter is a 404', async () => {
    const t = setup();
    t.prisma.workflowExecution.findFirst.mockResolvedValue(null);
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(null);
    await expect(t.svc.getExecution(user(), 'exB')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      t.svc.cancelExecution(user(), 'exB', 'reason here'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.svc.retryDeadLetter(user(), 'dlB')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      t.svc.resolveDeadLetter(user(), 'dlB', 'note here'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (
        t.prisma.workflowDeadLetter.findFirst.mock.calls[0] as unknown as [
          { where: Row },
        ]
      )[0].where.companyId,
    ).toBe('co-A');
  });
  it("a branch for a new workflow must belong to the caller's company", async () => {
    const t = setup();
    t.prisma.branch.findFirst.mockResolvedValue(null as never);
    await expect(
      t.svc.create(user(), {
        name: 'Abc',
        branchId: 'br-of-B',
        graph: good() as never,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (
        t.prisma.branch.findFirst.mock.calls[0] as unknown as [{ where: Row }]
      )[0].where,
    ).toMatchObject({ id: 'br-of-B', companyId: 'co-A' });
  });
});

describe('creating and versioning', () => {
  it('creates a draft with version 1, owned by the caller, and stores its validation', async () => {
    const t = setup();
    const r = await t.svc.create(user(), {
      name: ' Paid flow ',
      graph: good() as never,
    });
    expect(r.validation.ok).toBe(true);
    const data = (
      t.prisma.workflowDefinition.create.mock.calls[0] as unknown as [
        { data: Row },
      ]
    )[0].data;
    expect(data).toMatchObject({
      companyId: 'co-A',
      name: 'Paid flow',
      ownerIdentityId: 'id-1',
      createdByIdentityId: 'id-1',
    });
    expect(data.versions.create).toMatchObject({ version: 1 });
    expect(auditActions(t)).toContain('workflow.created');
  });
  it('saves an invalid draft (so work is never lost) but reports why it is invalid', async () => {
    const t = setup();
    const r = await t.svc.create(user(), {
      name: 'Abc',
      graph: { nodes: [], edges: [] },
    });
    expect(r.validation.ok).toBe(false);
  });
  it('a duplicate name is a conflict', async () => {
    const t = setup();
    const { Prisma } = jest.requireActual('@prisma/client');
    t.prisma.workflowDefinition.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      t.svc.create(user(), { name: 'Abc', graph: good() as never }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('edits an unlocked draft in place', async () => {
    const t = setup();
    const r = await t.svc.saveVersion(user(), 'wf1', {
      graph: good() as never,
    });
    expect(r).toMatchObject({ version: 1, createdNewVersion: false });
    expect(t.prisma.workflowVersion.create).not.toHaveBeenCalled();
  });
  it('a LOCKED version is never edited: the change becomes the next version, with a reason', async () => {
    const t = setup({ version: { isLocked: true } });
    await expect(
      t.svc.saveVersion(user(), 'wf1', { graph: good() as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.workflowVersion.update).not.toHaveBeenCalled();
    const r = await t.svc.saveVersion(user(), 'wf1', {
      graph: good() as never,
      changeReason: 'Add a second reminder',
    });
    expect(r).toMatchObject({ version: 2, createdNewVersion: true });
    expect(t.prisma.workflowVersion.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.workflowVersion.update).not.toHaveBeenCalled();
    expect(auditActions(t)).toContain('workflow.version_created');
  });
  it('two people creating the next version at once: only one wins', async () => {
    const t = setup({ version: { isLocked: true } });
    t.prisma.workflowDefinition.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      t.svc.saveVersion(user(), 'wf1', {
        graph: good() as never,
        changeReason: 'Concurrent edit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.prisma.workflowVersion.create).not.toHaveBeenCalled();
  });
  it('an archived workflow cannot be changed', async () => {
    const t = setup({ def: { status: 'ARCHIVED' } });
    await expect(
      t.svc.saveVersion(user(), 'wf1', { graph: good() as never }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('activation gates', () => {
  it('activates a valid workflow: locks the version, points the definition at it, and audits with before/after', async () => {
    const t = setup();
    const r = await t.svc.activate(user(), 'wf1');
    expect(r).toMatchObject({
      status: 'ACTIVE',
      activeVersion: 1,
      triggerEvent: 'payment.succeeded',
    });
    expect(
      (
        t.prisma.workflowVersion.update.mock.calls[0] as unknown as [
          { data: Row },
        ]
      )[0].data.isLocked,
    ).toBe(true);
    expect(
      (
        t.prisma.workflowDefinition.update.mock.calls[0] as unknown as [
          { data: Row },
        ]
      )[0].data,
    ).toMatchObject({
      status: 'ACTIVE',
      activeVersionId: 'v1',
      triggerEvent: 'payment.succeeded',
    });
    const rec = (t.audit.record.mock.calls as unknown as [Row][])
      .map((c) => c[0])
      .find((c) => c.action === 'workflow.activated');
    expect(rec).toMatchObject({
      companyId: 'co-A',
      previousValue: { status: 'DRAFT' },
      newValue: { status: 'ACTIVE', version: 1 },
    });
  });
  it('REFUSES to activate an invalid workflow, and returns why', async () => {
    const t = setup({
      version: {
        graph: {
          nodes: [
            {
              id: 'start',
              type: 'TRIGGER',
              config: { event: 'payment.succeeded' },
            },
          ],
          edges: [],
        },
      },
    });
    await expect(t.svc.activate(user(), 'wf1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(t.prisma.workflowDefinition.update).not.toHaveBeenCalled();
  });
  it('REFUSES an author who lacks a permission an action needs (no privilege escalation through automation)', async () => {
    const t = setup();
    await expect(
      t.svc.activate(user({ permissions: ['workflow:activate'] }), 'wf1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(t.prisma.workflowDefinition.update).not.toHaveBeenCalled();
  });
  it('an archived workflow cannot be activated', async () => {
    const t = setup({ def: { status: 'ARCHIVED' } });
    await expect(t.svc.activate(user(), 'wf1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('a schedule workflow starts from the NEXT window (activating does not fire a window that already passed)', async () => {
    const g = good();
    g.nodes[0].config = { schedule: { frequency: 'DAILY', hour: 9 } };
    g.nodes[1].config = {
      action: 'notify.email',
      subject: 'Digest',
      body: 'Window {{schedule.window}}',
    };
    const t = setup({ version: { graph: g } });
    await t.svc.activate(user(), 'wf1');
    const data = (
      t.prisma.workflowDefinition.update.mock.calls[0] as unknown as [
        { data: Row },
      ]
    )[0].data;
    expect(data.triggerEvent).toBe('schedule.wf1');
    expect(data.scheduleLastFiredAt).toBeInstanceOf(Date);
    expect(data.scheduleLastFiredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('lifecycle', () => {
  it('pause, disable and archive follow the state machine and audit with before/after', async () => {
    const t = setup({ def: { status: 'ACTIVE' } });
    await t.svc.setStatus(user(), 'wf1', 'PAUSED', 'maintenance window');
    expect(
      (
        t.prisma.workflowDefinition.update.mock.calls[0] as unknown as [
          { data: Row },
        ]
      )[0].data.status,
    ).toBe('PAUSED');
    expect(auditActions(t)).toContain('workflow.paused');
    await expect(
      t.svc.setStatus(user(), 'wf1', 'ARCHIVED', 'x'),
    ).rejects.toBeInstanceOf(ConflictException); // active -> archived not allowed
  });
  it('resume re-activates the version that was active, after re-validating it', async () => {
    const t = setup({ def: { status: 'PAUSED', activeVersionId: 'v1' } });
    const r = await t.svc.setStatus(user(), 'wf1', 'ACTIVE');
    expect(r).toMatchObject({ status: 'ACTIVE' });
  });
  it('only a paused or disabled workflow can be resumed', async () => {
    const t = setup({ def: { status: 'DRAFT' } });
    await expect(
      t.svc.setStatus(user(), 'wf1', 'ACTIVE'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('test mode and dry run', () => {
  it('a dry run records no execution and runs no action', async () => {
    const t = setup();
    const r = await t.svc.dryRun(user(), 'wf1', {
      payload: { payment: { amount: 5000 } },
    });
    expect(r.simulation?.wouldRun.map((w) => w.action)).toEqual([
      'notify.email',
    ]);
    expect(t.prisma.workflowExecution.create).not.toHaveBeenCalled();
    expect(t.executor.advance).not.toHaveBeenCalled();
    expect(auditActions(t)).toContain('workflow.dry_run');
  });
  it("a dry run still works for a viewer who lacks an action's permission (it cannot do anything)", async () => {
    const t = setup();
    const r = await t.svc.dryRun(
      user({ permissions: ['workflow:test'] }),
      'wf1',
      { payload: { payment: { amount: 1 } } },
    );
    expect(r.simulation).not.toBeNull();
  });
  it('test mode creates a TEST execution (mock actions), locks the version and moves a draft to TESTING', async () => {
    const t = setup();
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'exT',
      steps: [],
      deadLetters: [],
      workflow: { id: 'wf1', name: 'Flow' },
      companyId: 'co-A',
      eventId: null,
    });
    const r = await t.svc.test(user(), 'wf1', {
      payload: { payment: { amount: 5000 } },
    });
    expect(r.started).toBe(true);
    const data = (
      t.prisma.workflowExecution.create.mock.calls[0] as unknown as [
        { data: Row },
      ]
    )[0].data;
    expect(data).toMatchObject({
      mode: 'TEST',
      companyId: 'co-A',
      workflowId: 'wf1',
    });
    expect(data.executionKey).toMatch(/^test:/);
    expect(t.prisma.workflowVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isLocked: true }),
      }),
    );
    expect(
      (
        t.prisma.workflowDefinition.update.mock.calls[0] as unknown as [
          { data: Row },
        ]
      )[0].data.status,
    ).toBe('TESTING');
    expect(t.executor.advance).toHaveBeenCalledWith('exT');
  });
  it('will not test an invalid workflow', async () => {
    const t = setup({ version: { graph: { nodes: [], edges: [] } } });
    await expect(
      t.svc.test(user(), 'wf1', { payload: {} }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(t.prisma.workflowExecution.create).not.toHaveBeenCalled();
  });
  it("a sample cannot spoof the engine's reserved context keys", async () => {
    const t = setup();
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'exT',
      steps: [],
      deadLetters: [],
      workflow: {},
      companyId: 'co-A',
      eventId: null,
    });
    await t.svc.test(user(), 'wf1', {
      payload: {
        payment: { amount: 1 },
        event: { type: 'spoof' },
        steps: { evil: 1 },
      },
    });
    const ctx = (
      t.prisma.workflowExecution.create.mock.calls[0] as unknown as [
        { data: Row },
      ]
    )[0].data.context;
    expect(ctx.event.type).toBe('payment.succeeded');
    expect(ctx.steps).toEqual({});
  });
});

describe('executions and the dead-letter queue', () => {
  const dl = (over: Row = {}) => ({
    id: 'dl1',
    companyId: 'co-A',
    executionId: 'ex1',
    nodeId: 'pay',
    reason: 'PROVIDER_FAILED',
    status: 'OPEN',
    execution: {
      id: 'ex1',
      status: 'DEAD_LETTERED',
      versionId: 'v1',
      currentNodeId: 'pay',
    },
    ...over,
  });

  it('retry resets the failed step, requeues the execution, audits it, and re-runs it', async () => {
    const t = setup();
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(dl());
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'ex1',
      steps: [],
      deadLetters: [],
      workflow: {},
      companyId: 'co-A',
      eventId: null,
    });
    await t.svc.retryDeadLetter(user(), 'dl1');
    expect(t.prisma.workflowExecutionStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { executionId: 'ex1', nodeId: 'pay', status: 'FAILED' },
        data: expect.objectContaining({ status: 'RETRYING', attempts: 0 }),
      }),
    );
    expect(auditActions(t)).toContain('workflow.execution_retried');
    expect(t.executor.advance).toHaveBeenCalledWith('ex1');
  });
  it('refuses to retry a failure caused by the workflow itself (a loop, a bad graph)', async () => {
    const t = setup();
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(
      dl({ reason: 'LOOP_CYCLE' }),
    );
    await expect(t.svc.retryDeadLetter(user(), 'dl1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.executor.advance).not.toHaveBeenCalled();
  });
  it('a step that moves money needs an explicit confirmation to be retried', async () => {
    const g: WorkflowGraph = {
      nodes: [
        {
          id: 'start',
          type: 'TRIGGER',
          config: { event: 'payment.succeeded' },
        },
        { id: 'pay', type: 'ACTION', config: { action: 'payment.charge' } },
        { id: 'done', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'pay' },
        { from: 'pay', to: 'done' },
      ],
    };
    const t = setup({ version: { graph: g } });
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(dl());
    await expect(
      t.svc.retryDeadLetter(user(), 'dl1', false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.executor.advance).not.toHaveBeenCalled();
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'ex1',
      steps: [],
      deadLetters: [],
      workflow: {},
      companyId: 'co-A',
      eventId: null,
    });
    await t.svc.retryDeadLetter(user(), 'dl1', true);
    expect(t.executor.advance).toHaveBeenCalledWith('ex1');
  });
  it('an entry that is already handled cannot be handled twice', async () => {
    const t = setup();
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(
      dl({ status: 'RETRIED' }),
    );
    await expect(t.svc.retryDeadLetter(user(), 'dl1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      t.svc.resolveDeadLetter(user(), 'dl1', 'already done'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('resolve records who resolved it and why, and audits', async () => {
    const t = setup();
    t.prisma.workflowDeadLetter.findFirst.mockResolvedValue(dl());
    await t.svc.resolveDeadLetter(
      user(),
      'dl1',
      'Handled by hand with the customer',
    );
    expect(t.prisma.workflowDeadLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedByIdentityId: 'id-1',
          resolutionNote: 'Handled by hand with the customer',
        }),
      }),
    );
    expect(auditActions(t)).toContain('workflow.dead_letter_resolved');
  });
  it('cancel marks the execution cancelled, cancels its open dead letters, and audits with the reason', async () => {
    const t = setup();
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'ex1',
      status: 'WAITING',
      branchId: null,
    });
    await t.svc.cancelExecution(user(), 'ex1', 'Customer changed their mind');
    expect(t.prisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(t.prisma.workflowDeadLetter.updateMany).toHaveBeenCalled();
    const rec = (t.audit.record.mock.calls as unknown as [Row][])
      .map((c) => c[0])
      .find((c) => c.action === 'workflow.execution_cancelled');
    expect(rec?.reason).toBe('Customer changed their mind');
  });
  it('a finished execution cannot be cancelled', async () => {
    const t = setup();
    t.prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'ex1',
      status: 'COMPLETED',
      branchId: null,
    });
    await expect(
      t.svc.cancelExecution(user(), 'ex1', 'too late'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('searches by execution id, entity id, correlation id and workflow name', async () => {
    const t = setup();
    await t.svc.listExecutions(user(), { search: 'BK-123' });
    const where = (
      t.prisma.workflowExecution.findMany.mock.calls[0] as unknown as [
        { where: Row },
      ]
    )[0].where;
    expect(where.companyId).toBe('co-A');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { id: 'BK-123' },
        { entityId: 'BK-123' },
        { correlationId: 'BK-123' },
      ]),
    );
  });
});
