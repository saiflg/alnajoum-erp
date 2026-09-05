import { Test, TestingModule } from '@nestjs/testing';
import {
  TaskPriority,
  TaskRelatedType,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../crm/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisaOpsAutomationService } from './visa-ops-automation.service';

// @nestjs/schedule ships an ESM build Jest's default transform can't parse —
// same workaround as hajj-ops-automation.service.spec.ts.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_9AM: '0 9 * * *' },
}));

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('VisaOpsAutomationService', () => {
  let service: VisaOpsAutomationService;
  let prisma: {
    visaApplication: { findMany: jest.Mock; update: jest.Mock };
  };
  let tasksService: { createAuto: jest.Mock };
  let notificationsService: { sendGeneric: jest.Mock };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      visaApplication: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    tasksService = {
      createAuto: jest.fn().mockResolvedValue({ id: 'task-1' }),
    };
    notificationsService = { sendGeneric: jest.fn() };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaOpsAutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TasksService, useValue: tasksService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(VisaOpsAutomationService);
  });

  describe('spec #30 — SLA overdue tracking', () => {
    it('creates a staff task for an application past its slaDueAt', async () => {
      prisma.visaApplication.findMany.mockResolvedValueOnce([
        {
          id: 'app-1',
          applicationReference: 'VISA-2026-000001',
          assignedStaffId: 'staff-1',
          appliedByStaffId: null,
          slaDueAt: daysAgo(2),
        },
      ]);

      const result = await service.runAll();

      expect(tasksService.createAuto).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedType: TaskRelatedType.VISA,
          relatedId: 'app-1:sla-overdue',
          assignedStaffId: 'staff-1',
          priority: TaskPriority.HIGH,
        }),
      );
      expect(result.overdueTasks).toBe(1);
    });

    it('falls back to the applying staff member when no one is assigned', async () => {
      prisma.visaApplication.findMany.mockResolvedValueOnce([
        {
          id: 'app-1',
          applicationReference: 'VISA-2026-000001',
          assignedStaffId: null,
          appliedByStaffId: 'staff-2',
          slaDueAt: daysAgo(1),
        },
      ]);

      await service.runAll();

      expect(tasksService.createAuto).toHaveBeenCalledWith(
        expect.objectContaining({ assignedStaffId: 'staff-2' }),
      );
    });

    it('skips an overdue application with no staff assigned at all, rather than creating an unassigned task', async () => {
      prisma.visaApplication.findMany.mockResolvedValueOnce([
        {
          id: 'app-1',
          applicationReference: 'VISA-2026-000001',
          assignedStaffId: null,
          appliedByStaffId: null,
          slaDueAt: daysAgo(1),
        },
      ]);

      const result = await service.runAll();

      expect(tasksService.createAuto).not.toHaveBeenCalled();
      expect(result.overdueTasks).toBe(0);
    });
  });

  describe('spec #23 — expiry tracking', () => {
    it('moves an issued application whose expiryDate has passed to EXPIRED and notifies the customer', async () => {
      prisma.visaApplication.findMany.mockResolvedValueOnce([]); // overdue sweep
      prisma.visaApplication.findMany.mockResolvedValueOnce([
        {
          id: 'app-1',
          applicationReference: 'VISA-2026-000001',
          destinationCountry: 'UAE',
          expiryDate: daysAgo(1),
          customer: {
            identity: { email: 'amina@example.com', id: 'identity-1' },
          },
        },
      ]);

      const result = await service.runAll();

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.EXPIRED },
      });
      expect(notificationsService.sendGeneric).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.stringContaining('Visa expired'),
        expect.any(String),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_application.expired' }),
      );
      expect(result.expiredCount).toBe(1);
    });

    it('the expiry sweep query excludes applications already EXPIRED/CANCELLED/REJECTED', async () => {
      prisma.visaApplication.findMany.mockResolvedValue([]);

      await service.runAll();

      expect(prisma.visaApplication.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({
              notIn: [
                VisaApplicationStatus.EXPIRED,
                VisaApplicationStatus.CANCELLED,
                VisaApplicationStatus.REJECTED,
              ],
            }),
          }),
        }),
      );
    });
  });
});
