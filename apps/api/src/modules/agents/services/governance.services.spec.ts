// @nestjs/schedule ships ES modules that Jest does not transform; the cron decorators are irrelevant here.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_MINUTE: '* * * * *' },
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AiRiskLevel } from '@prisma/client';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { AiApprovalsService } from './ai-approvals.service';
import { AiBudgetService } from './budget.service';
import { AiControlsService, GLOBAL } from './controls.service';
import { AiMemoryService } from './memory.service';
import { AiKnowledgeService } from './knowledge.service';

const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

describe('AiControlsService: a company can only make things stricter', () => {
  const rows = (r: object[]) => ({
    aiControl: { findMany: jest.fn().mockResolvedValue(r) },
  });
  const make = (r: object[]) =>
    new AiControlsService(rows(r) as never, audit() as never);

  it('merges global and company switches', async () => {
    const c = await make([
      {
        scopeKey: GLOBAL,
        kind: 'AUTONOMY_CAP',
        targetKey: '',
        value: { level: 3 },
      },
      {
        scopeKey: 'co',
        kind: 'AUTONOMY_CAP',
        targetKey: '',
        value: { level: 1 },
      },
      {
        scopeKey: 'co',
        kind: 'TOOL_DISABLED',
        targetKey: 'createPaymentLink',
        value: { enabled: true },
      },
      {
        scopeKey: GLOBAL,
        kind: 'FORCE_APPROVAL',
        targetKey: '',
        value: { enabled: true },
      },
    ]).resolve('co', 'customer_service');
    expect(c.autonomyCap).toBe(1);
    expect(c.disabledTools.has('createPaymentLink')).toBe(true);
    expect(c.forceApproval).toBe(true);
  });
  it('a company cannot RAISE the platform autonomy cap', async () => {
    const c = await make([
      {
        scopeKey: GLOBAL,
        kind: 'AUTONOMY_CAP',
        targetKey: '',
        value: { level: 2 },
      },
      {
        scopeKey: 'co',
        kind: 'AUTONOMY_CAP',
        targetKey: '',
        value: { level: 5 },
      },
    ]).resolve('co', 'x');
    expect(c.autonomyCap).toBe(2);
  });
  it('a platform-wide feature switch-off beats a company switch-on', async () => {
    const c = await make([
      {
        scopeKey: GLOBAL,
        kind: 'FEATURE_FLAG',
        targetKey: 'channel.whatsapp',
        value: { enabled: false },
      },
      {
        scopeKey: 'co',
        kind: 'FEATURE_FLAG',
        targetKey: 'channel.whatsapp',
        value: { enabled: true },
      },
    ]).resolve('co', 'x');
    expect(c.featureFlags['channel.whatsapp']).toBe(false);
  });
  it('a company communication policy only narrows the platform one', async () => {
    const c = await make([
      {
        scopeKey: GLOBAL,
        kind: 'COMM_POLICY',
        targetKey: '',
        value: {
          channels: ['PORTAL', 'EMAIL'],
          maxMessagesPerCustomerPerDay: 3,
          allowedHours: { start: 8, end: 20 },
        },
      },
      {
        scopeKey: 'co',
        kind: 'COMM_POLICY',
        targetKey: '',
        value: {
          channels: ['PORTAL', 'SMS'],
          maxMessagesPerCustomerPerDay: 10,
          allowedHours: { start: 6, end: 23 },
          prohibitedContent: ['free upgrade'],
        },
      },
    ]).resolve('co', 'x');
    expect(c.commPolicy.channels).toEqual(['PORTAL']);
    expect(c.commPolicy.maxMessagesPerCustomerPerDay).toBe(3);
    expect(c.commPolicy.allowedHours).toEqual({ start: 8, end: 20 });
    expect(c.commPolicy.prohibitedContent).toContain('free upgrade');
  });
  it("another company's switches never apply to me", async () => {
    const prisma = rows([]);
    await new AiControlsService(prisma as never, audit() as never).resolve(
      'co-a',
      'x',
    );
    expect(
      prisma.aiControl.findMany.mock.calls[0][0].where.scopeKey.in,
    ).toEqual([GLOBAL, 'co-a']);
  });
  it('setting a control is audited with who and why, and an invalid cap is refused', async () => {
    const a = audit();
    const prisma = {
      aiControl: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const svc = new AiControlsService(prisma as never, a as never);
    await svc.set(
      'co',
      { kind: 'ALL_DISABLED', reason: 'incident' },
      { identityId: 'u1', companyId: 'co' },
    );
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.control_changed',
        reason: 'incident',
        identityId: 'u1',
      }),
    );
    await expect(
      svc.set(
        'co',
        { kind: 'AUTONOMY_CAP', value: { level: 9 } },
        { identityId: 'u1', companyId: 'co' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set(
        'co',
        { kind: 'TOOL_DISABLED' },
        { identityId: 'u1', companyId: 'co' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AiBudgetService', () => {
  const make = (
    budgets: object[],
    agg: { tok: number; req: number; cost?: number },
  ) =>
    new AiBudgetService(
      {
        aiBudget: {
          findMany: jest.fn().mockResolvedValue(budgets),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
        },
        aiExecution: {
          aggregate: jest.fn().mockResolvedValue({
            _sum: {
              promptTokens: agg.tok,
              completionTokens: 0,
              costMicros: agg.cost ?? 0,
            },
            _count: { _all: agg.req },
          }),
        },
      } as never,
      audit() as never,
    );
  it('blocks a run once a request limit is reached and says which limit', async () => {
    const v = await make(
      [
        {
          scopeKey: 'co',
          agentKey: 'customer_service',
          period: 'DAILY',
          maxRequests: 5,
          maxTokens: null,
          maxCostMicros: null,
        },
      ],
      { tok: 10, req: 5 },
    ).check('co', 'customer_service');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('daily budget');
  });
  it('allows a run below the limit and warns at 80%', async () => {
    const v = await make(
      [
        {
          scopeKey: 'co',
          agentKey: '',
          period: 'MONTHLY',
          maxTokens: 100,
          maxRequests: null,
          maxCostMicros: null,
        },
      ],
      { tok: 85, req: 3 },
    ).check('co', 'x');
    expect(v.ok).toBe(true);
    expect(v.warnings).toHaveLength(1);
  });
  it('blocks on cost as well as on tokens', async () => {
    const v = await make(
      [
        {
          scopeKey: 'co',
          agentKey: '',
          period: 'DAILY',
          maxTokens: null,
          maxRequests: null,
          maxCostMicros: 500,
        },
      ],
      { tok: 1, req: 1, cost: 600 },
    ).check('co', 'x');
    expect(v.ok).toBe(false);
  });
  it('a company budget cannot exceed the platform limit', async () => {
    const prisma = {
      aiBudget: {
        findUnique: jest.fn().mockResolvedValue({
          maxRequests: 100,
          maxTokens: null,
          maxCostMicros: null,
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'b1' }),
      },
      aiExecution: {},
    };
    const svc = new AiBudgetService(prisma as never, audit() as never);
    await expect(
      svc.set('co', { period: 'DAILY', maxRequests: 500 }, { identityId: 'u' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set(
        'co',
        { period: 'DAILY', maxRequests: null },
        { identityId: 'u' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await svc.set(
      'co',
      { period: 'DAILY', maxRequests: 50 },
      { identityId: 'u' },
    );
    expect(prisma.aiBudget.upsert).toHaveBeenCalled();
  });
});

describe('AiMemoryService: agents may remember only approved things', () => {
  const prisma = () => ({
    aiMemory: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  });
  const base = {
    companyId: 'co',
    type: 'PREFERENCE' as const,
    subjectType: 'CUSTOMER',
    subjectId: 'c1',
    source: 'customer_service',
  };
  it('refuses a key that is not on the list (e.g. a password or card)', async () => {
    const svc = new AiMemoryService(prisma() as never);
    await expect(
      svc.write({ ...base, key: 'password', value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.write({ ...base, key: 'cardNumber', value: '4111111111111111' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('refuses a subject type the memory type cannot be about, and the unwritable KNOWLEDGE type', async () => {
    const svc = new AiMemoryService(prisma() as never);
    await expect(
      svc.write({
        ...base,
        key: 'preferredAirline',
        subjectType: 'BOOKING',
        value: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.write({ ...base, type: 'KNOWLEDGE', key: 'x', value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('masks credentials inside an allowed value and gives every memory an expiry', async () => {
    const p = prisma();
    await new AiMemoryService(p as never).write({
      ...base,
      key: 'preferredAirline',
      value: { note: 'password: hunter22' },
    });
    const data = p.aiMemory.upsert.mock.calls[0][0].create;
    expect(JSON.stringify(data.value)).not.toContain('hunter22');
    expect(data.expiresAt).toBeInstanceOf(Date);
  });
  it('stores no preference for a customer who switched personalisation off', async () => {
    const p = prisma();
    p.aiMemory.findUnique.mockResolvedValue({
      value: { enabled: false },
      deletedAt: null,
      expiresAt: null,
    });
    await expect(
      new AiMemoryService(p as never).write({
        ...base,
        key: 'preferredCabin',
        value: 'BUSINESS',
      }),
    ).rejects.toThrow(/personalisation/);
  });
  it('rejects an oversized value', async () => {
    await expect(
      new AiMemoryService(prisma() as never).write({
        ...base,
        key: 'preferredAirline',
        value: 'x'.repeat(5000),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('deleting a subject removes every row (used when a customer is erased)', async () => {
    const p = prisma();
    expect(
      await new AiMemoryService(p as never).deleteForSubject(
        'co',
        'CUSTOMER',
        'c1',
      ),
    ).toEqual({ removed: 2 });
    expect(p.aiMemory.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'co', subjectType: 'CUSTOMER', subjectId: 'c1' },
    });
  });
});

describe('AiKnowledgeService', () => {
  it("only offers published, currently-effective entries from this company or the platform, never another company's", async () => {
    const prisma = {
      aiKnowledgeSource: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new AiKnowledgeService(prisma as never, audit() as never).search(
      'refund policy',
      { companyId: 'co-a', branchId: 'br-1' },
    );
    const where = prisma.aiKnowledgeSource.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PUBLISHED');
    expect(JSON.stringify(where)).toContain('co-a');
    expect(JSON.stringify(where)).not.toContain('co-b');
    expect(where.AND[1].OR).toContainEqual({ companyId: null });
  });
  it('ranks branch policy over company policy over platform policy and returns the citation label', async () => {
    const row = (
      id: string,
      companyId: string | null,
      branchId: string | null,
    ) => ({
      id,
      companyId,
      branchId,
      title: 'Refund policy',
      content: 'refund within 14 days',
      category: 'REFUND',
      version: 2,
      sourceLabel: `label-${id}`,
    });
    const prisma = {
      aiKnowledgeSource: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            row('p', null, null),
            row('c', 'co', null),
            row('b', 'co', 'br'),
          ]),
      },
    };
    const hits = await new AiKnowledgeService(
      prisma as never,
      audit() as never,
    ).search('refund', { companyId: 'co', branchId: 'br' });
    expect(hits.map((h) => h.id)).toEqual(['b', 'c', 'p']);
    expect(hits[0].sourceLabel).toBe('label-b');
  });
  it('returns nothing (so the agent says it does not know) when no entry matches', async () => {
    const prisma = {
      aiKnowledgeSource: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'x',
            companyId: null,
            branchId: null,
            title: 'Parking',
            content: 'car park rules',
            category: 'SOP',
            version: 1,
            sourceLabel: 's',
          },
        ]),
      },
    };
    expect(
      await new AiKnowledgeService(prisma as never, audit() as never).search(
        'refund policy',
        { companyId: 'co', branchId: null },
      ),
    ).toEqual([]);
  });
});

describe('AiApprovalsService: nobody approves their own AI action', () => {
  const user = (over: Partial<AuthContext> = {}): AuthContext => ({
    sub: 'approver',
    type: 'STAFF',
    roles: ['COMPANY_ADMIN'],
    permissions: ['approval:decide', 'flight:cancel'],
    companyId: 'co',
    sessionId: null,
    ...over,
  });
  const row = (over: object = {}) => ({
    id: 'ap1',
    status: 'PENDING',
    toolKey: 'cancelFlightBooking',
    executionId: 'ex1',
    companyId: 'co',
    initiatorIdentityId: 'customer-identity',
    approvalRequestId: null,
    params: { bookingReference: 'ANJ-1' },
    editedParams: null,
    expiresAt: null,
    agent: { key: 'customer_service', name: 'CS' },
    execution: {},
    ...over,
  });
  const make = (
    r: object,
    extra: { claim?: number; execute?: jest.Mock } = {},
  ) => {
    const execute =
      extra.execute ??
      jest.fn().mockResolvedValue({
        data: { done: true },
        sources: [],
        summary: 'cancelled',
      });
    const prisma = {
      aiApproval: {
        findFirst: jest.fn().mockResolvedValue(r),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: extra.claim ?? 1 }),
      },
      aiExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aiConversationMessage: { create: jest.fn() },
      aiConversation: { update: jest.fn() },
    };
    const tool = {
      key: 'cancelFlightBooking',
      risk: AiRiskLevel.HIGH_RISK,
      executeOnApproval: true,
      input: { bookingReference: { type: 'string', description: 'x' } },
      execute,
    };
    const tools = { get: () => tool };
    const principals = {
      fromAuth: jest.fn().mockResolvedValue({ kind: 'STAFF', companyId: 'co' }),
    };
    const svc = new AiApprovalsService(
      prisma as never,
      audit() as never,
      { decide: jest.fn() } as never,
      tools as never,
      principals as never,
    );
    return { svc, prisma, execute };
  };
  it('refuses the person who started the action', async () => {
    const t = make(row({ initiatorIdentityId: 'approver' }));
    await expect(
      t.svc.decide('ap1', user(), 'APPROVE', undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.execute).not.toHaveBeenCalled();
  });
  it("refuses a staff member who lacks the action's own permission (or a customer)", async () => {
    const t = make(row());
    await expect(
      t.svc.decide(
        'ap1',
        user({ permissions: ['approval:decide'] }),
        'APPROVE',
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      t.svc.decide(
        'ap1',
        user({ type: 'CUSTOMER' as never }),
        'APPROVE',
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.execute).not.toHaveBeenCalled();
  });
  it('an authorised approval runs the action exactly once, under the approver', async () => {
    const t = make(row());
    await t.svc.decide('ap1', user(), 'APPROVE', 'ok');
    expect(t.execute).toHaveBeenCalledTimes(1);
    expect(t.execute.mock.calls[0][0].principal).toMatchObject({
      kind: 'STAFF',
    });
  });
  it('if someone else decided in the meantime, nothing runs (409)', async () => {
    const t = make(row(), { claim: 0 });
    await expect(
      t.svc.decide('ap1', user(), 'APPROVE', undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.execute).not.toHaveBeenCalled();
  });
  it('an already-decided request cannot be decided again', async () => {
    const t = make(row({ status: 'EXECUTED' }));
    await expect(
      t.svc.decide('ap1', user(), 'APPROVE', undefined),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('a rejection needs a reason and never runs the action', async () => {
    const t = make(row());
    await expect(
      t.svc.decide('ap1', user(), 'REJECT', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await t.svc.decide('ap1', user(), 'REJECT', 'not eligible');
    expect(t.execute).not.toHaveBeenCalled();
  });
  it('an edited approval is validated against the tool schema before it is stored', async () => {
    const t = make(row());
    await expect(
      t.svc.decide('ap1', user(), 'APPROVE', undefined, { somethingElse: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it("another company's approver cannot even find it", async () => {
    const t = make(null as never);
    await expect(
      t.svc.decide('ap1', user({ companyId: 'other' }), 'APPROVE', undefined),
    ).rejects.toThrow(/not found/i);
    expect(t.prisma.aiApproval.findFirst.mock.calls[0][0].where.companyId).toBe(
      'other',
    );
  });
});
