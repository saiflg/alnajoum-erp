import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffCardsService } from './staff-cards.service';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

const NOW = new Date();
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const staffSummary = (over: Record<string, unknown> = {}) => ({
  id: 'staff-1',
  employeeCode: 'EMP-001',
  firstName: 'Amina',
  lastName: 'Yusuf',
  jobTitle: 'Agent',
  department: 'Sales',
  isActive: true,
  photoFilename: null,
  branch: { id: 'br-1', name: 'Head Office' },
  ...over,
});

const cardRow = (over: Record<string, unknown> = {}) => ({
  id: 'card-1',
  companyId: 'co-A',
  staffId: 'staff-1',
  cardNumber: 'ALN-C-AAAA-BBBB',
  verificationToken: 'T'.repeat(22),
  status: 'ACTIVE',
  issuedAt: daysFromNow(-100),
  expiresAt: daysFromNow(200),
  activatedAt: daysFromNow(-100),
  suspendedAt: null,
  revokedAt: null,
  replacedAt: null,
  statusReason: null,
  replacedByCardId: null,
  printedCount: 0,
  lastPrintedAt: null,
  expiryNoticeSentAt: null,
  createdAt: daysFromNow(-100),
  staff: staffSummary(),
  ...over,
});

describe('StaffCardsService', () => {
  let prisma: Record<string, any>;
  let audit: { record: jest.Mock };
  let settings: { get: jest.Mock };
  let notifications: { sendWorkflowMessage: jest.Mock };
  let service: StaffCardsService;
  const admin = { identityId: 'id-admin', staffId: 'staff-admin' };

  beforeEach(() => {
    prisma = {
      staff: { findFirst: jest.fn(), findMany: jest.fn() },
      staffIdCard: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      staffIdCardEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      staffIdCardScan: { groupBy: jest.fn().mockResolvedValue([]) },
      staffCardSettings: { findMany: jest.fn().mockResolvedValue([]) },
      identity: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    settings = {
      get: jest.fn().mockResolvedValue({
        validityMonths: 24,
        expiryWarningDays: 30,
        companyId: 'co-A',
      }),
    };
    notifications = {
      sendWorkflowMessage: jest.fn().mockResolvedValue({ sent: true }),
    };
    service = new StaffCardsService(
      prisma as never,
      audit as never,
      settings as never,
      notifications as never,
    );
  });

  describe('issuing', () => {
    const staffRow = {
      id: 'staff-1',
      companyId: 'co-A',
      isActive: true,
      employeeCode: 'EMP-001',
    };
    const loaded = () => {
      // get() after issuing reloads the card
      prisma.staffIdCard.findFirst.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          where.staffId
            ? Promise.resolve(null)
            : Promise.resolve(cardRow({ status: 'PENDING' })),
      );
    };

    it("refuses another company's staff member as if they did not exist", async () => {
      prisma.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.issue({ staffId: 'x' }, admin, 'co-A'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.staff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'co-A' }),
        }),
      );
    });

    it('does not issue to a deactivated staff member', async () => {
      prisma.staff.findFirst.mockResolvedValue({
        ...staffRow,
        isActive: false,
      });
      await expect(
        service.issue({ staffId: 'staff-1' }, admin, 'co-A'),
      ).rejects.toThrow(/deactivated/);
    });

    it('does not let an administrator issue a card to themselves', async () => {
      prisma.staff.findFirst.mockResolvedValue({
        ...staffRow,
        id: 'staff-admin',
      });
      await expect(
        service.issue({ staffId: 'staff-admin' }, admin, 'co-A'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a second live card for the same person, pointing at renew / replace', async () => {
      prisma.staff.findFirst.mockResolvedValue(staffRow);
      prisma.staffIdCard.findFirst.mockResolvedValue({
        cardNumber: 'ALN-C-OLD1-OLD2',
        status: 'ACTIVE',
      });
      await expect(
        service.issue({ staffId: 'staff-1' }, admin, 'co-A'),
      ).rejects.toThrow(/already has a active card.*Renew or replace/);
      expect(prisma.staffIdCard.create).not.toHaveBeenCalled();
    });

    it('locks the staff row so two simultaneous issues cannot both succeed', async () => {
      prisma.staff.findFirst.mockResolvedValue(staffRow);
      prisma.staffIdCard.create.mockResolvedValue(
        cardRow({ status: 'PENDING' }),
      );
      loaded();
      prisma.staffIdCard.findFirst.mockResolvedValueOnce(null); // no live card
      await service.issue({ staffId: 'staff-1' }, admin, 'co-A');
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('creates a PENDING card with fresh identifiers and records who issued it', async () => {
      prisma.staff.findFirst.mockResolvedValue(staffRow);
      prisma.staffIdCard.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(cardRow({ ...data, id: 'new-1' })),
      );
      loaded();
      prisma.staffIdCard.findFirst.mockResolvedValueOnce(null);

      await service.issue(
        { staffId: 'staff-1', validityMonths: 12 },
        admin,
        'co-A',
      );

      const data = prisma.staffIdCard.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.verificationToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(data.cardNumber).toMatch(/^ALN-C-/);
      expect(data.createdByIdentityId).toBe('id-admin');
      expect(prisma.staffIdCardEvent.create).toHaveBeenCalledTimes(1);
      expect(
        prisma.staffIdCardEvent.create.mock.calls[0][0].data,
      ).toMatchObject({
        action: 'ISSUED',
        actorIdentityId: 'id-admin',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff_card.issued',
          companyId: 'co-A',
        }),
      );
    });

    it('with activateNow it is ACTIVE at once and the history shows both steps', async () => {
      prisma.staff.findFirst.mockResolvedValue(staffRow);
      prisma.staffIdCard.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(cardRow({ ...data, id: 'new-2' })),
      );
      loaded();
      prisma.staffIdCard.findFirst.mockResolvedValueOnce(null);
      await service.issue(
        { staffId: 'staff-1', activateNow: true },
        admin,
        'co-A',
      );
      expect(prisma.staffIdCard.create.mock.calls[0][0].data.status).toBe(
        'ACTIVE',
      );
      expect(
        prisma.staffIdCardEvent.create.mock.calls.map(
          (c: [{ data: { action: string } }]) => c[0].data.action,
        ),
      ).toEqual(['ISSUED', 'ACTIVATED']);
    });
  });

  describe('state changes', () => {
    const arrange = (over: Record<string, unknown> = {}) => {
      const card = cardRow(over);
      prisma.staffIdCard.findFirst.mockResolvedValue(card);
      return card;
    };

    it('loads cards only within the caller company', async () => {
      arrange();
      await service.suspend('card-1', 'Under review', admin, 'co-A');
      expect(prisma.staffIdCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'card-1', companyId: 'co-A' },
        }),
      );
    });

    it('a card of another company is simply not found', async () => {
      prisma.staffIdCard.findFirst.mockResolvedValue(null);
      await expect(
        service.revoke('card-9', 'Lost', admin, 'co-A'),
      ).rejects.toThrow(NotFoundException);
    });

    it('suspends an active card, recording actor, reason and the before / after states', async () => {
      arrange();
      await service.suspend('card-1', 'Investigation', admin, 'co-A');
      expect(prisma.staffIdCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'card-1', status: 'ACTIVE' },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          statusReason: 'Investigation',
        }),
      });
      expect(
        prisma.staffIdCardEvent.create.mock.calls[0][0].data,
      ).toMatchObject({
        action: 'SUSPENDED',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        reason: 'Investigation',
        actorIdentityId: 'id-admin',
      });
    });

    it.each(['suspend', 'reinstate', 'revoke'] as const)(
      '%s needs a written reason',
      async (action) => {
        arrange({ status: action === 'reinstate' ? 'SUSPENDED' : 'ACTIVE' });
        await expect(
          service[action]('card-1', '   ', admin, 'co-A'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.staffIdCard.updateMany).not.toHaveBeenCalled();
      },
    );

    it('cannot suspend a card that is not active', async () => {
      arrange({ status: 'REVOKED' });
      await expect(
        service.suspend('card-1', 'x1x', admin, 'co-A'),
      ).rejects.toThrow(/revoked card cannot be suspended/);
    });

    it('treats a card past its expiry date as expired even if the nightly sweep has not run', async () => {
      arrange({ expiresAt: daysFromNow(-2) });
      await expect(
        service.suspend('card-1', 'x1x', admin, 'co-A'),
      ).rejects.toThrow(/expired card cannot be suspended/);
    });

    it('an administrator cannot change their own card', async () => {
      arrange({
        staffId: 'staff-admin',
        staff: staffSummary({ id: 'staff-admin' }),
      });
      await expect(
        service.revoke('card-1', 'Because', admin, 'co-A'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.staffIdCard.updateMany).not.toHaveBeenCalled();
    });

    it('writes nothing when someone else changed the card at the same moment', async () => {
      arrange();
      prisma.staffIdCard.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.suspend('card-1', 'Because', admin, 'co-A'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.staffIdCardEvent.create).not.toHaveBeenCalled();
    });

    it('a deactivated staff member cannot have a card reinstated or renewed', async () => {
      arrange({
        status: 'SUSPENDED',
        staff: staffSummary({ isActive: false }),
      });
      await expect(
        service.reinstate('card-1', 'Back', admin, 'co-A'),
      ).rejects.toThrow(ConflictException);
    });

    it('renewing early extends from the current expiry so no days are lost', async () => {
      const expiry = daysFromNow(60);
      arrange({ expiresAt: expiry });
      await service.renew('card-1', { validityMonths: 12 }, admin, 'co-A');
      const data = prisma.staffIdCard.updateMany.mock.calls[0][0].data;
      const years = (data.expiresAt.getTime() - expiry.getTime()) / 86_400_000;
      expect(years).toBeGreaterThan(364);
      expect(years).toBeLessThan(367);
      expect(data.expiryNoticeSentAt).toBeNull();
    });

    it('renewing an expired card starts from today and brings it back to ACTIVE', async () => {
      arrange({ status: 'EXPIRED', expiresAt: daysFromNow(-30) });
      await service.renew('card-1', { validityMonths: 24 }, admin, 'co-A');
      const data = prisma.staffIdCard.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('ACTIVE');
      const days = (data.expiresAt.getTime() - NOW.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(728);
    });

    it('reinstating a suspended card whose date has passed returns it as expired, not active', async () => {
      arrange({ status: 'SUSPENDED', expiresAt: daysFromNow(-1) });
      await service.reinstate('card-1', 'Cleared', admin, 'co-A');
      expect(prisma.staffIdCard.updateMany.mock.calls[0][0].data.status).toBe(
        'EXPIRED',
      );
    });

    it('activates a pending card', async () => {
      arrange({ status: 'PENDING', activatedAt: null });
      await service.activate('card-1', admin, 'co-A');
      expect(prisma.staffIdCard.updateMany.mock.calls[0][0].data).toMatchObject(
        {
          status: 'ACTIVE',
        },
      );
    });

    it('replacing retires the old card for good and issues a linked new one', async () => {
      arrange();
      prisma.staffIdCard.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            cardRow({ ...data, id: 'card-2', status: data.status }),
          ),
      );
      await service.replace(
        'card-1',
        { reason: 'Lost the card' },
        admin,
        'co-A',
      );
      expect(prisma.staffIdCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'card-1', status: 'ACTIVE' },
        data: expect.objectContaining({
          status: 'REPLACED',
          statusReason: 'Lost the card',
        }),
      });
      expect(prisma.staffIdCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { replacedByCardId: 'card-2' },
      });
      const created = prisma.staffIdCard.create.mock.calls[0][0].data;
      expect(created.status).toBe('ACTIVE'); // the old one was active
      expect(created.verificationToken).not.toBe('T'.repeat(22)); // a new, different token
    });

    it('replacing needs a reason', async () => {
      arrange();
      await expect(
        service.replace('card-1', { reason: ' ' }, admin, 'co-A'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('when a staff member leaves', () => {
    it('revokes every card they still hold and keeps the history', async () => {
      prisma.staffIdCard.findMany.mockResolvedValue([
        { id: 'c1', companyId: 'co-A', status: 'ACTIVE', cardNumber: 'N1' },
        { id: 'c2', companyId: 'co-A', status: 'SUSPENDED', cardNumber: 'N2' },
      ]);
      const n = await service.deactivateForStaff('staff-1', 'id-admin');
      expect(n).toBe(2);
      expect(prisma.staffIdCard.updateMany).toHaveBeenCalledTimes(2);
      expect(
        prisma.staffIdCardEvent.create.mock.calls.map(
          (c: [{ data: { action: string } }]) => c[0].data.action,
        ),
      ).toEqual(['STAFF_DEACTIVATED', 'STAFF_DEACTIVATED']);
      expect(prisma.staffIdCard.update).not.toHaveBeenCalled(); // nothing is deleted
    });

    it('an event handler never throws into the staff-management flow', async () => {
      prisma.staffIdCard.findMany.mockRejectedValue(new Error('db down'));
      await expect(
        service.onStaffDeactivated({ staffId: 'staff-1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('expiry sweep', () => {
    it('records expiries once and warns the company administrators once per card', async () => {
      prisma.staffIdCard.findMany
        .mockResolvedValueOnce([{ id: 'c1' }]) // due to expire
        .mockResolvedValueOnce([
          cardRow({ id: 'c2', expiresAt: daysFromNow(10) }),
        ]); // expiring soon
      prisma.staffCardSettings.findMany.mockResolvedValue([
        { companyId: 'co-A', expiryWarningDays: 30 },
      ]);
      prisma.identity.findMany.mockResolvedValue([
        { id: 'id-admin', email: 'boss@example.com' },
      ]);

      const r = await service.sweep(NOW);

      expect(r).toEqual({ expired: 1, warned: 1 });
      expect(
        prisma.staffIdCardEvent.create.mock.calls[0][0].data,
      ).toMatchObject({
        cardId: 'c1',
        action: 'EXPIRED',
      });
      expect(notifications.sendWorkflowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'card-expiry:c2:id-admin',
          to: 'boss@example.com',
        }),
      );
      // the warning is only sent for cards not already warned
      expect(prisma.staffIdCard.findMany.mock.calls[1][0].where).toMatchObject({
        expiryNoticeSentAt: null,
      });
    });

    it('does nothing when nothing is due', async () => {
      expect(await service.sweep(NOW)).toEqual({ expired: 0, warned: 0 });
    });
  });

  describe('lists', () => {
    it('is confined to the caller company and pages its results', async () => {
      prisma.staffIdCard.count.mockResolvedValue(51);
      prisma.staffIdCard.findMany.mockResolvedValue([cardRow()]);
      const r = await service.list({ page: 3, pageSize: 10 }, 'co-A');
      expect(r.total).toBe(51);
      expect(prisma.staffIdCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(prisma.staffIdCard.findMany.mock.calls[0][0].where).toMatchObject({
        companyId: 'co-A',
      });
    });

    it('the EXPIRED filter also finds active cards whose date has passed', async () => {
      await service.list({ status: 'EXPIRED' }, 'co-A');
      const where = prisma.staffIdCard.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"status":"EXPIRED"');
      expect(JSON.stringify(where)).toContain('"status":"ACTIVE"');
    });

    it('never exposes the verification token in a list', async () => {
      prisma.staffIdCard.count.mockResolvedValue(1);
      prisma.staffIdCard.findMany.mockResolvedValue([cardRow()]);
      const r = await service.list({}, 'co-A');
      expect(JSON.stringify(r)).not.toContain('T'.repeat(22));
    });

    it('lists only active staff without a live card as candidates for issuing', async () => {
      await service.staffWithoutCard('co-A');
      const where = prisma.staff.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        isActive: true,
        companyId: 'co-A',
        idCards: {
          none: {
            status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'] },
          },
        },
      });
    });
  });
});
