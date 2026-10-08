import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
// @nestjs/schedule ships ES modules that Jest does not transform; the cron decorators are irrelevant here.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_MINUTE: '* * * * *' },
}));

import { AccessReviewsService } from './access-reviews.service';
import { BreakGlassService } from './break-glass.service';
import { IncidentsService } from './incidents.service';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';
import { SecurityOverviewService } from './security-overview.service';
import { StepUpService } from './step-up.service';

const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

/** A prisma stand-in where every model method is a jest.fn() created on demand (resolving the given value). */
function fakePrisma(overrides: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, jest.Mock>> = {};
  const modelProxies: Record<string, unknown> = {};
  const transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(root)
      : Promise.all(arg as unknown[]),
  );
  const root: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === '$transaction') return transaction;
        return (modelProxies[prop] ??= new Proxy(
          {},
          {
            get(_m, method: string) {
              store[prop] ??= {};
              if (!store[prop][method]) {
                const o = overrides[prop]?.[method];
                store[prop][method] =
                  typeof o === 'function'
                    ? (o as jest.Mock)
                    : jest.fn().mockResolvedValue(o);
              }
              return store[prop][method];
            },
          },
        ));
      },
    },
  );
  return root as Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
}

describe('IncidentsService', () => {
  const actor = { identityId: 'u1', companyId: 'co-1' };

  it('opens an incident with a first timeline note and an audit record', async () => {
    const prisma = fakePrisma({ securityIncident: { create: { id: 'i1' } } });
    const a = audit();
    const svc = new IncidentsService(prisma as never, a as never);
    await svc.open(
      {
        title: 'Leaked key',
        description: 'An API key was pasted in chat',
        severity: 'HIGH',
        personalDataInvolved: true,
      },
      actor,
    );
    const data = prisma.securityIncident.create.mock.calls[0][0].data;
    expect(data.companyId).toBe('co-1');
    expect(data.notes.create.statusChange).toBe('OPEN');
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.incident_opened' }),
    );
  });

  it("another company's incident is NotFound", async () => {
    const prisma = fakePrisma({ securityIncident: { findFirst: null } });
    const svc = new IncidentsService(prisma as never, audit() as never);
    await expect(svc.get('x', 'co-2')).rejects.toThrow(NotFoundException);
    expect(prisma.securityIncident.findFirst.mock.calls[0][0].where).toEqual({
      id: 'x',
      companyId: 'co-2',
    });
  });

  it('allows only legal status moves and refuses to re-open a closed incident', async () => {
    const closed = { id: 'i1', status: 'CLOSED', companyId: 'co-1', notes: [] };
    const svc = new IncidentsService(
      fakePrisma({ securityIncident: { findFirst: closed } }) as never,
      audit() as never,
    );
    await expect(
      svc.changeStatus('i1', 'OPEN', 'again', actor),
    ).rejects.toThrow(ConflictException);
    const open = { ...closed, status: 'OPEN' };
    const svc2 = new IncidentsService(
      fakePrisma({ securityIncident: { findFirst: open } }) as never,
      audit() as never,
    );
    await expect(
      svc2.changeStatus('i1', 'CLOSED', 'skip', actor),
    ).rejects.toThrow(ConflictException);
  });

  it('a stale status change (someone else moved it first) is refused, not applied', async () => {
    const prisma = fakePrisma({
      securityIncident: {
        findFirst: { id: 'i1', status: 'OPEN', companyId: 'co-1', notes: [] },
        updateMany: { count: 0 },
      },
    });
    const svc = new IncidentsService(prisma as never, audit() as never);
    await expect(
      svc.changeStatus('i1', 'INVESTIGATING', 'on it', actor),
    ).rejects.toThrow(/changed by someone else/);
    expect(prisma.securityIncidentNote.create).not.toHaveBeenCalled();
  });
});

describe('AccessReviewsService', () => {
  const actor = { identityId: 'reviewer', companyId: 'co-1' };
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'it1',
    identityId: 'target',
    email: 't@x.co',
    roles: ['STAFF'],
    decision: 'PENDING',
    ...over,
  });

  it('snapshots every active staff account with its roles', async () => {
    const prisma = fakePrisma({
      accessReview: { findFirst: null, create: { id: 'r1', items: [1, 2] } },
      staff: {
        findMany: [
          {
            firstName: 'A',
            lastName: 'B',
            identity: {
              id: 'i1',
              email: 'a@x.co',
              status: 'ACTIVE',
              lastLoginAt: null,
              twoFactorEnabled: false,
              roles: [{ role: { name: 'STAFF' } }],
            },
          },
        ],
      },
    });
    await new AccessReviewsService(prisma as never, audit() as never).start(
      actor,
    );
    const created = prisma.accessReview.create.mock.calls[0][0].data;
    expect(created.items.create[0]).toMatchObject({
      identityId: 'i1',
      roles: ['STAFF'],
      staffName: 'A B',
    });
    expect(prisma.staff.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'co-1',
      isActive: true,
    });
  });

  it('refuses a second review while one is open', async () => {
    const prisma = fakePrisma({ accessReview: { findFirst: { id: 'open' } } });
    await expect(
      new AccessReviewsService(prisma as never, audit() as never).start(actor),
    ).rejects.toThrow(ConflictException);
  });

  it('the reviewer cannot decide on their own access', async () => {
    const prisma = fakePrisma({
      accessReview: {
        findFirst: {
          id: 'r1',
          status: 'OPEN',
          companyId: 'co-1',
          items: [item({ identityId: 'reviewer' })],
        },
      },
    });
    await expect(
      new AccessReviewsService(prisma as never, audit() as never).decide(
        'r1',
        'it1',
        'KEEP',
        undefined,
        actor,
        'co-1',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.accessReviewItem.update).not.toHaveBeenCalled();
  });

  it('will not complete while any account is undecided', async () => {
    const prisma = fakePrisma({
      accessReview: {
        findFirst: {
          id: 'r1',
          status: 'OPEN',
          companyId: 'co-1',
          items: [item()],
        },
      },
    });
    await expect(
      new AccessReviewsService(prisma as never, audit() as never).complete(
        'r1',
        actor,
        'co-1',
      ),
    ).rejects.toThrow(/not been decided/);
    expect(prisma.identity.update).not.toHaveBeenCalled();
  });

  it('completing applies revocations: account deactivated, sessions ended, audited; keeps are untouched', async () => {
    const items = [
      item({ decision: 'REVOKE' }),
      item({ id: 'it2', identityId: 'kept', decision: 'KEEP' }),
    ];
    const prisma = fakePrisma({
      accessReview: {
        findFirst: { id: 'r1', status: 'OPEN', companyId: 'co-1', items },
        updateMany: { count: 1 },
      },
    });
    const a = audit();
    await new AccessReviewsService(prisma as never, a as never).complete(
      'r1',
      actor,
      'co-1',
    );
    expect(prisma.identity.update).toHaveBeenCalledTimes(1);
    expect(prisma.identity.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: { status: 'DEACTIVATED' },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identityId: 'target', revokedAt: null },
      }),
    );
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.access_revoked' }),
    );
  });

  it("another company's review is NotFound", async () => {
    const prisma = fakePrisma({ accessReview: { findFirst: null } });
    await expect(
      new AccessReviewsService(prisma as never, audit() as never).get(
        'r1',
        'co-2',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PrivacyService', () => {
  const actor = { identityId: 'staff-1' };
  const customer = {
    id: 'c1',
    companyId: 'co-1',
    identityId: 'id1',
    identity: { id: 'id1', email: 'a@x.co', phone: null, status: 'ACTIVE' },
  };

  it("another company's customer is NotFound for export and erasure", async () => {
    const prisma = fakePrisma({ customer: { findFirst: null } });
    const svc = new PrivacyService(prisma as never, audit() as never);
    await expect(svc.exportData('c1', actor, 'co-2')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      svc.erase('c1', 'requested by the customer', actor, 'co-2'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
      companyId: 'co-2',
    });
  });

  it('refuses erasure while money is owed, recording the refusal and changing nothing', async () => {
    const prisma = fakePrisma({
      customer: { findFirst: customer },
      invoice: { count: 2 },
      wallet: { findUnique: null },
      manualPaymentSubmission: { count: 0 },
    });
    const a = audit();
    await expect(
      new PrivacyService(prisma as never, a as never).erase(
        'c1',
        'customer asked',
        actor,
        'co-1',
      ),
    ).rejects.toThrow(/2 invoice/);
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.identity.update).not.toHaveBeenCalled();
    expect(
      prisma.dataSubjectRequest.create.mock.calls[0][0].data,
    ).toMatchObject({ type: 'ERASURE', status: 'REFUSED' });
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.erasure_refused' }),
    );
  });

  it('anonymises the person but keeps the financial records', async () => {
    const prisma = fakePrisma({
      customer: { findFirst: customer },
      invoice: { count: 0 },
      wallet: { findUnique: null },
      manualPaymentSubmission: { count: 0 },
      customerDocument: {
        findMany: [{ id: 'd1', storedFileName: 'does-not-exist.png' }],
      },
      familyMember: { findMany: [{ id: 'f1', documents: [] }] },
    });
    const a = audit();
    const result = await new PrivacyService(prisma as never, a as never).erase(
      'c1',
      'customer asked for erasure',
      actor,
      'co-1',
    );

    const cust = prisma.customer.update.mock.calls[0][0].data;
    expect(cust).toMatchObject({
      firstName: 'Erased',
      passportNumber: null,
      address: null,
      dateOfBirth: null,
      emergencyContactPhone: null,
    });
    const ident = prisma.identity.update.mock.calls[0][0].data;
    expect(ident.email).toBe('erased+c1@erased.invalid');
    expect(ident.status).toBe('DEACTIVATED');
    expect(ident.passwordHash).not.toBe('');
    expect(prisma.customerDocument.deleteMany).toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    // Financial tables are never touched.
    expect(prisma.invoice.deleteMany).not.toHaveBeenCalled();
    expect(prisma.payment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.journalEntry.deleteMany).not.toHaveBeenCalled();
    expect(result.financialRecordsKept).toBe(true);
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.customer_erased' }),
    );
  });

  it('refuses to erase twice', async () => {
    const erased = {
      ...customer,
      identity: { ...customer.identity, email: 'erased+c1@erased.invalid' },
    };
    const prisma = fakePrisma({ customer: { findFirst: erased } });
    await expect(
      new PrivacyService(prisma as never, audit() as never).erase(
        'c1',
        'again please',
        actor,
        'co-1',
      ),
    ).rejects.toThrow(/already been erased/);
  });
});

describe('RetentionService', () => {
  it('previews what is past retention without deleting anything', async () => {
    const prisma = fakePrisma({
      refreshToken: { count: 5 },
      passwordResetToken: { count: 1 },
      notification: { count: 9 },
      whatsAppWebhookEvent: { count: 0 },
      workflowEvent: { count: 2 },
    });
    const rows = await new RetentionService(
      prisma as never,
      audit() as never,
    ).preview();
    expect(rows.map((r) => r.due)).toEqual([5, 1, 9, 0, 2]);
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('a run deletes only past the cutoff, reports counts and is audited; audit logs and finance are never touched', async () => {
    const prisma = fakePrisma({
      refreshToken: { deleteMany: { count: 3 } },
      passwordResetToken: { deleteMany: { count: 0 } },
      notification: { deleteMany: { count: 7 } },
      whatsAppWebhookEvent: { deleteMany: { count: 0 } },
      workflowEvent: { deleteMany: { count: 1 } },
    });
    const a = audit();
    const out = await new RetentionService(prisma as never, a as never).run(
      'admin',
    );
    expect(out).toEqual([
      { key: 'refresh_tokens', removed: 3 },
      { key: 'password_reset_tokens', removed: 0 },
      { key: 'notifications', removed: 7 },
      { key: 'whatsapp_webhook_events', removed: 0 },
      { key: 'workflow_events', removed: 1 },
    ]);
    const where = prisma.notification.deleteMany.mock.calls[0][0].where;
    expect(where.createdAt.lt.getTime()).toBeLessThan(
      Date.now() - 300 * 86_400_000,
    );
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.payment.deleteMany).not.toHaveBeenCalled();
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.retention_run' }),
    );
  });

  it('retention periods can be changed by environment and ignore nonsense', () => {
    process.env.RETENTION_NOTIFICATIONS_DAYS = '30';
    process.env.RETENTION_SESSIONS_DAYS = 'abc';
    const rules = new RetentionService(
      fakePrisma() as never,
      audit() as never,
    ).rules();
    expect(rules.find((r) => r.key === 'notifications')?.days).toBe(30);
    expect(rules.find((r) => r.key === 'refresh_tokens')?.days).toBe(30);
    delete process.env.RETENTION_NOTIFICATIONS_DAYS;
    delete process.env.RETENTION_SESSIONS_DAYS;
  });
});

describe('BreakGlassService', () => {
  const holder = { identityId: 'staff-1', companyId: 'co-1' };
  const okRole = { id: 'role-fin', name: 'FINANCE_OFFICER' };
  const input = {
    roleId: 'role-fin',
    reason: 'Month-end close needs ledger access',
    minutes: 30,
  };

  it('validates the request: reason, duration, not SUPER_ADMIN, not already held', async () => {
    const mk = (over: Record<string, Record<string, unknown>> = {}) =>
      new BreakGlassService(
        fakePrisma({
          role: { findUnique: okRole },
          identityRole: { findUnique: null },
          ...over,
        }) as never,
        audit() as never,
      );
    await expect(
      mk().request({ ...input, reason: 'short' }, holder),
    ).rejects.toThrow(BadRequestException);
    await expect(
      mk().request({ ...input, minutes: 600 }, holder),
    ).rejects.toThrow(BadRequestException);
    await expect(
      mk({ role: { findUnique: { id: 'r', name: 'SUPER_ADMIN' } } }).request(
        input,
        holder,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      mk({ identityRole: { findUnique: { id: 'held' } } }).request(
        input,
        holder,
      ),
    ).rejects.toThrow(/already hold/);
    const prisma = fakePrisma({
      role: { findUnique: okRole },
      identityRole: { findUnique: null },
      breakGlassGrant: { create: { id: 'g1', reason: input.reason } },
    });
    await new BreakGlassService(prisma as never, audit() as never).request(
      input,
      holder,
    );
    expect(prisma.breakGlassGrant.create.mock.calls[0][0].data).toMatchObject({
      identityId: 'staff-1',
      roleName: 'FINANCE_OFFICER',
      durationMinutes: 30,
    });
    expect(prisma.identityRole.create).not.toHaveBeenCalled(); // asking grants nothing
  });

  it('nobody approves their own emergency access', async () => {
    const prisma = fakePrisma({
      breakGlassGrant: {
        findUnique: { id: 'g1', identityId: 'sa-1', durationMinutes: 30 },
      },
    });
    await expect(
      new BreakGlassService(prisma as never, audit() as never).approve('g1', {
        identityId: 'sa-1',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.identityRole.create).not.toHaveBeenCalled();
  });

  it('approval grants the role for the requested time, atomically, and is audited', async () => {
    const grant = {
      id: 'g1',
      identityId: 'staff-1',
      roleId: 'role-fin',
      roleName: 'FINANCE_OFFICER',
      companyId: 'co-1',
      durationMinutes: 30,
      reason: 'x'.repeat(12),
    };
    const prisma = fakePrisma({
      breakGlassGrant: {
        findUnique: grant,
        updateMany: { count: 1 },
        findUniqueOrThrow: grant,
      },
    });
    const a = audit();
    await new BreakGlassService(prisma as never, a as never).approve('g1', {
      identityId: 'sa-2',
    });
    const claim = prisma.breakGlassGrant.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'g1', status: 'REQUESTED' });
    const minutes =
      (claim.data.expiresAt.getTime() - claim.data.approvedAt.getTime()) /
      60_000;
    expect(Math.round(minutes)).toBe(30);
    expect(prisma.identityRole.create).toHaveBeenCalledWith({
      data: { identityId: 'staff-1', roleId: 'role-fin', companyId: 'co-1' },
    });
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.break_glass_activated' }),
    );
  });

  it('a second approver loses the race and nothing is granted twice', async () => {
    const prisma = fakePrisma({
      breakGlassGrant: {
        findUnique: { id: 'g1', identityId: 'staff-1', durationMinutes: 30 },
        updateMany: { count: 0 },
      },
    });
    await expect(
      new BreakGlassService(prisma as never, audit() as never).approve('g1', {
        identityId: 'sa-2',
      }),
    ).rejects.toThrow(/already been decided/);
    expect(prisma.identityRole.create).not.toHaveBeenCalled();
  });

  it('the sweep removes the role of every grant whose time is up, and only those', async () => {
    const due = {
      id: 'g1',
      identityId: 'staff-1',
      roleId: 'role-fin',
      roleName: 'FINANCE_OFFICER',
      companyId: 'co-1',
    };
    const prisma = fakePrisma({
      breakGlassGrant: {
        findMany: [{ id: 'g1' }],
        findUniqueOrThrow: due,
        updateMany: { count: 1 },
      },
    });
    const a = audit();
    const n = await new BreakGlassService(
      prisma as never,
      a as never,
    ).expireDue(new Date());
    expect(n).toBe(1);
    expect(
      prisma.breakGlassGrant.findMany.mock.calls[0][0].where,
    ).toMatchObject({ status: 'ACTIVE', expiresAt: { lte: expect.any(Date) } });
    expect(prisma.identityRole.deleteMany).toHaveBeenCalledWith({
      where: { identityId: 'staff-1', roleId: 'role-fin' },
    });
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.break_glass_expired' }),
    );
  });

  describe('revoke (who may end a grant)', () => {
    const grant = (status: string) => ({
      id: 'g1',
      identityId: 'holder',
      roleId: 'role-fin',
      roleName: 'FINANCE_OFFICER',
      companyId: 'co-1',
      status,
    });
    const svc = (prisma: unknown) =>
      new BreakGlassService(prisma as never, audit() as never);

    it("another user (e.g. another company's staff) cannot end someone else's grant, and is told it does not exist", async () => {
      const prisma = fakePrisma({
        breakGlassGrant: { findUnique: grant('ACTIVE') },
      });
      await expect(
        svc(prisma).revoke('g1', { identityId: 'stranger' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.breakGlassGrant.updateMany).not.toHaveBeenCalled();
      expect(prisma.identityRole.deleteMany).not.toHaveBeenCalled();
    });

    it('the holder can give an active grant back (role removed)', async () => {
      const prisma = fakePrisma({
        breakGlassGrant: {
          findUnique: grant('ACTIVE'),
          findUniqueOrThrow: grant('ACTIVE'),
          updateMany: { count: 1 },
        },
      });
      await svc(prisma).revoke('g1', { identityId: 'holder' });
      expect(prisma.identityRole.deleteMany).toHaveBeenCalledWith({
        where: { identityId: 'holder', roleId: 'role-fin' },
      });
    });

    it('a Super Admin can end any grant', async () => {
      const prisma = fakePrisma({
        breakGlassGrant: {
          findUnique: grant('ACTIVE'),
          findUniqueOrThrow: grant('ACTIVE'),
          updateMany: { count: 1 },
        },
      });
      await svc(prisma).revoke('g1', {
        identityId: 'root',
        isSuperAdmin: true,
      });
      expect(prisma.identityRole.deleteMany).toHaveBeenCalled();
    });

    it('the holder can withdraw a request nobody has decided yet (no role is touched)', async () => {
      const prisma = fakePrisma({
        breakGlassGrant: {
          findUnique: grant('REQUESTED'),
          findUniqueOrThrow: grant('REVOKED'),
          updateMany: { count: 1 },
        },
      });
      await svc(prisma).revoke('g1', { identityId: 'holder' });
      expect(prisma.breakGlassGrant.updateMany).toHaveBeenCalledWith({
        where: { id: 'g1', status: 'REQUESTED' },
        data: { status: 'REVOKED', endedAt: expect.any(Date) },
      });
      expect(prisma.identityRole.deleteMany).not.toHaveBeenCalled();
    });

    it('an already finished grant cannot be revoked again', async () => {
      const prisma = fakePrisma({
        breakGlassGrant: { findUnique: grant('EXPIRED') },
      });
      await expect(
        svc(prisma).revoke('g1', { identityId: 'holder' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('does not remove a role if the grant was already ended by someone else', async () => {
    const due = {
      id: 'g1',
      identityId: 'staff-1',
      roleId: 'role-fin',
      roleName: 'x',
      companyId: 'co-1',
    };
    const prisma = fakePrisma({
      breakGlassGrant: {
        findMany: [{ id: 'g1' }],
        findUniqueOrThrow: due,
        updateMany: { count: 0 },
      },
    });
    await new BreakGlassService(prisma as never, audit() as never).expireDue(
      new Date(),
    );
    expect(prisma.identityRole.deleteMany).not.toHaveBeenCalled();
  });
});

describe('StepUpService', () => {
  const config = {
    getOrThrow: () => 'step-up-test-secret-step-up-test-secret',
  };

  it('issues a proof for the right password and audits a wrong one', async () => {
    const passwordHash = await argon2.hash('Correct#1234');
    const prisma = fakePrisma({
      identity: {
        findUnique: {
          id: 'u1',
          status: 'ACTIVE',
          twoFactorEnabled: false,
          passwordHash,
        },
      },
    });
    const a = audit();
    const svc = new StepUpService(
      prisma as never,
      {} as never,
      a as never,
      config as never,
    );
    const ok = await svc.issue('u1', { password: 'Correct#1234' });
    expect(ok.stepUpToken.split('.')).toHaveLength(3);
    expect(ok.expiresInSeconds).toBe(300);
    await expect(svc.issue('u1', { password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(a.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.step_up_failed' }),
    );
  });

  it('an account with two-factor must give a code: its password alone is not enough', async () => {
    const passwordHash = await argon2.hash('Correct#1234');
    const prisma = fakePrisma({
      identity: {
        findUnique: {
          id: 'u1',
          status: 'ACTIVE',
          twoFactorEnabled: true,
          passwordHash,
        },
      },
    });
    const twoFactor = { verifyChallenge: jest.fn().mockResolvedValue(true) };
    const svc = new StepUpService(
      prisma as never,
      twoFactor as never,
      audit() as never,
      config as never,
    );
    await expect(svc.issue('u1', { password: 'Correct#1234' })).rejects.toThrow(
      BadRequestException,
    );
    expect(twoFactor.verifyChallenge).not.toHaveBeenCalled();
    await expect(svc.issue('u1', { code: '123456' })).resolves.toHaveProperty(
      'stepUpToken',
    );
    twoFactor.verifyChallenge.mockResolvedValue(false);
    await expect(svc.issue('u1', { code: '000000' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses an inactive account', async () => {
    const prisma = fakePrisma({
      identity: { findUnique: { id: 'u1', status: 'DEACTIVATED' } },
    });
    await expect(
      new StepUpService(
        prisma as never,
        {} as never,
        audit() as never,
        config as never,
      ).issue('u1', { password: 'x' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('SecurityOverviewService', () => {
  it("computes live counts, scoped to the caller's company", async () => {
    const prisma = fakePrisma({
      auditLog: { count: 4 },
      securityIncident: { count: 1 },
      staff: {
        findMany: [
          { identity: { lastLoginAt: null, twoFactorEnabled: false } },
          { identity: { lastLoginAt: new Date(), twoFactorEnabled: true } },
        ],
      },
      identity: {
        findMany: [
          { email: 'a@x.co', twoFactorEnabled: false },
          { email: 'b@x.co', twoFactorEnabled: true },
        ],
      },
    });
    const o = await new SecurityOverviewService(prisma as never).overview(
      'co-1',
    );
    expect(o.accounts).toMatchObject({
      activeStaff: 2,
      notSeenIn90Days: 1,
      privilegedAccounts: 2,
      privilegedWithoutTwoFactor: 1,
      privilegedWithoutTwoFactorEmails: ['a@x.co'],
    });
    expect(o.incidents.open).toBe(1);
    for (const call of prisma.auditLog.count.mock.calls)
      expect(call[0].where.companyId).toBe('co-1');
  });

  it('the control register measures instead of asserting: a missing backup FAILS, an unobservable restore test is UNKNOWN', async () => {
    const prisma = fakePrisma({
      auditLog: { count: 0 },
      securityIncident: { count: 0 },
      identity: { findMany: [] },
      accessReview: { findFirst: null },
    });
    const prevDir = process.env.BACKUPS_DIR;
    process.env.BACKUPS_DIR = './definitely-not-a-real-backup-dir';
    const controls = await new SecurityOverviewService(
      prisma as never,
    ).controls('co-1');
    process.env.BACKUPS_DIR = prevDir;
    const byId = Object.fromEntries(controls.map((c) => [c.id, c]));
    expect(byId['DAT-01'].status).toBe('FAIL');
    expect(byId['DAT-02'].status).toBe('UNKNOWN');
    expect(byId['ACC-02'].status).toBe('FAIL'); // never reviewed
    expect(byId['ACC-01'].status).toBe('UNKNOWN'); // no privileged accounts to measure
    expect(byId['INC-01'].status).toBe('PASS');
    for (const c of controls) expect(c.evidence.length).toBeGreaterThan(0);
  });
});
