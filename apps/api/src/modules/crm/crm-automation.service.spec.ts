import { Test, TestingModule } from '@nestjs/testing';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from './tasks.service';

// @nestjs/schedule ships an ESM build Jest's default (node_modules-excluded)
// transform can't parse; CrmAutomationService only needs the `@Cron`
// decorator's presence, not its actual scheduling behavior, in this suite —
// mocked here rather than widening the project's transformIgnorePatterns
// for every test.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_9AM: '0 9 * * *' },
}));

import { CrmAutomationService } from './crm-automation.service';

describe('CrmAutomationService', () => {
  let service: CrmAutomationService;
  let prisma: Record<string, any>;
  let notificationsService: { sendGeneric: jest.Mock };
  let tasksService: { flagOverdue: jest.Mock; createAuto: jest.Mock };

  beforeEach(async () => {
    prisma = {
      visaApplication: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      guarantor: { findMany: jest.fn().mockResolvedValue([]) },
      flightBooking: { findMany: jest.fn().mockResolvedValue([]) },
      supportTicket: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      escalationRule: { findMany: jest.fn().mockResolvedValue([]) },
      ticketEscalation: { create: jest.fn() },
      identity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notificationsService = { sendGeneric: jest.fn() };
    tasksService = {
      flagOverdue: jest.fn().mockResolvedValue(0),
      createAuto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmAutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TasksService, useValue: tasksService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(CrmAutomationService);
  });

  describe('spec #13 — SLA breach flagging', () => {
    it('flags tickets with no first response past their SLA deadline, and only those', async () => {
      prisma.supportTicket.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.runAll();

      expect(prisma.supportTicket.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            firstRespondedAt: null,
            slaBreached: false,
            status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
          }),
          data: { slaBreached: true },
        }),
      );
      expect(result.slaBreaches).toBe(2);
    });
  });

  describe('spec #25 — escalation', () => {
    const rule = {
      id: 'rule-1',
      priority: TicketPriority.CRITICAL,
      afterMinutes: 120,
      notifyRole: 'BRANCH_MANAGER',
      order: 1,
      isActive: true,
    };
    const oldTicket = {
      id: 'ticket-1',
      ticketNumber: 'TKT-1',
      subject: 'Server down',
      priority: TicketPriority.CRITICAL,
      status: TicketStatus.OPEN,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours old
      escalations: [],
    };

    it('notifies the configured role and records the escalation when a ticket has aged past the rule threshold', async () => {
      prisma.escalationRule.findMany.mockResolvedValue([rule]);
      prisma.supportTicket.findMany.mockResolvedValue([oldTicket]);
      prisma.identity.findMany.mockResolvedValue([
        { id: 'manager-1', email: 'manager@example.com' },
      ]);

      const result = await service.runAll();

      expect(notificationsService.sendGeneric).toHaveBeenCalledWith(
        'manager@example.com',
        'manager-1',
        expect.stringContaining('TKT-1'),
        expect.any(String),
      );
      expect(prisma.ticketEscalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ticketId: 'ticket-1', notifiedRole: 'BRANCH_MANAGER' },
        }),
      );
      expect(result.escalations).toBe(1);
    });

    it('never re-notifies the same role twice for the same ticket', async () => {
      prisma.escalationRule.findMany.mockResolvedValue([rule]);
      prisma.supportTicket.findMany.mockResolvedValue([
        { ...oldTicket, escalations: [{ notifiedRole: 'BRANCH_MANAGER' }] },
      ]);

      const result = await service.runAll();

      expect(notificationsService.sendGeneric).not.toHaveBeenCalled();
      expect(prisma.ticketEscalation.create).not.toHaveBeenCalled();
      expect(result.escalations).toBe(0);
    });

    it('does not escalate a ticket that has not yet aged past the rule threshold', async () => {
      prisma.escalationRule.findMany.mockResolvedValue([rule]);
      prisma.supportTicket.findMany.mockResolvedValue([
        { ...oldTicket, createdAt: new Date(Date.now() - 30 * 60 * 1000) }, // only 30 min old
      ]);

      const result = await service.runAll();

      expect(notificationsService.sendGeneric).not.toHaveBeenCalled();
      expect(result.escalations).toBe(0);
    });
  });
});
