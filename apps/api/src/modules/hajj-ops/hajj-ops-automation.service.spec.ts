import { Test, TestingModule } from '@nestjs/testing';
import { TaskPriority, TaskRelatedType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TasksService } from '../crm/tasks.service';
import { HajjOpsAutomationService } from './hajj-ops-automation.service';

// @nestjs/schedule ships an ESM build Jest's default transform can't parse —
// same workaround as crm-automation.service.spec.ts.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_9AM: '0 9 * * *' },
}));

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe('HajjOpsAutomationService', () => {
  let service: HajjOpsAutomationService;
  let prisma: Record<string, any>;
  let tasksService: { createAuto: jest.Mock };

  beforeEach(async () => {
    prisma = {
      hajjGroup: { findMany: jest.fn().mockResolvedValue([]) },
      umrahGroup: { findMany: jest.fn().mockResolvedValue([]) },
    };
    tasksService = {
      createAuto: jest.fn().mockResolvedValue({ id: 'task-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HajjOpsAutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TasksService, useValue: tasksService },
      ],
    }).compile();

    service = module.get(HajjOpsAutomationService);
  });

  describe('spec #26 — departure countdown tasks at 30/14/7/3/1 days', () => {
    it('creates a task for the group coordinator when a group is exactly one configured interval from departure', async () => {
      prisma.hajjGroup.findMany.mockResolvedValue([
        {
          id: 'group-1',
          groupNumber: 'HGRP-AAAA',
          name: 'Ramadan Batch',
          departureDate: daysFromNow(7),
          coordinatorStaffId: 'staff-1',
        },
      ]);

      const result = await service.runAll();

      expect(tasksService.createAuto).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedType: TaskRelatedType.HAJJ,
          relatedId: 'group-1:7',
          assignedStaffId: 'staff-1',
        }),
      );
      expect(result.hajjDepartureTasks).toBe(1);
    });

    it('does not create a task when the group is not on one of the configured intervals', async () => {
      prisma.hajjGroup.findMany.mockResolvedValue([
        {
          id: 'group-1',
          groupNumber: 'HGRP-AAAA',
          name: 'Ramadan Batch',
          departureDate: daysFromNow(20), // not 30/14/7/3/1
          coordinatorStaffId: 'staff-1',
        },
      ]);

      const result = await service.runAll();

      expect(tasksService.createAuto).not.toHaveBeenCalled();
      expect(result.hajjDepartureTasks).toBe(0);
    });

    it('skips a group with no coordinator rather than creating an unassigned task', async () => {
      prisma.hajjGroup.findMany.mockResolvedValue([
        {
          id: 'group-1',
          groupNumber: 'HGRP-AAAA',
          name: 'Ramadan Batch',
          departureDate: daysFromNow(1),
          coordinatorStaffId: null,
        },
      ]);

      const result = await service.runAll();

      expect(tasksService.createAuto).not.toHaveBeenCalled();
      expect(result.hajjDepartureTasks).toBe(0);
    });

    it('uses NORMAL priority outside the final 3-day window', async () => {
      prisma.umrahGroup.findMany.mockResolvedValue([
        {
          id: 'group-2',
          groupNumber: 'UGRP-BBBB',
          name: 'VIP Umrah',
          departureDate: daysFromNow(14),
          coordinatorStaffId: 'staff-2',
        },
      ]);

      await service.runAll();

      expect(tasksService.createAuto).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedType: TaskRelatedType.UMRAH,
          priority: TaskPriority.NORMAL,
        }),
      );
    });

    it('uses HIGH priority within the final 3-day window', async () => {
      prisma.umrahGroup.findMany.mockResolvedValue([
        {
          id: 'group-3',
          groupNumber: 'UGRP-CCCC',
          name: 'Family Umrah',
          departureDate: daysFromNow(1),
          coordinatorStaffId: 'staff-3',
        },
      ]);

      await service.runAll();

      expect(tasksService.createAuto).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedType: TaskRelatedType.UMRAH,
          relatedId: 'group-3:1',
          priority: TaskPriority.HIGH,
        }),
      );
    });
  });
});
