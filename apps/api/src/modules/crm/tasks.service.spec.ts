import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  describe('createAuto (spec #9)', () => {
    it('creates a new auto task when none exists yet for this relatedType/relatedId', async () => {
      prisma.task.findFirst.mockResolvedValue(null);
      prisma.task.create.mockResolvedValue({ id: 'task-1' });

      await service.createAuto({
        title: 'Missing documents on visa application VISA-1',
        relatedType: 'VISA',
        relatedId: 'app-1',
        assignedStaffId: 'staff-1',
        dueDate: new Date(),
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isAutoCreated: true,
            relatedId: 'app-1',
          }),
        }),
      );
    });

    it('is idempotent — does not create a duplicate while an open auto task already exists for the same source', async () => {
      prisma.task.findFirst.mockResolvedValue({ id: 'existing-task' });

      const result = await service.createAuto({
        title: 'Missing documents on visa application VISA-1',
        relatedType: 'VISA',
        relatedId: 'app-1',
        assignedStaffId: 'staff-1',
        dueDate: new Date(),
      });

      expect(prisma.task.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'existing-task' });
    });

    it('always creates fresh when there is no relatedId to dedupe against', async () => {
      prisma.task.create.mockResolvedValue({ id: 'task-2' });

      await service.createAuto({
        title: 'Generic reminder',
        relatedType: 'OTHER',
        assignedStaffId: 'staff-1',
        dueDate: new Date(),
      });

      expect(prisma.task.findFirst).not.toHaveBeenCalled();
      expect(prisma.task.create).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('rejects updating an already-completed task', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: 'task-1',
        status: TaskStatus.COMPLETED,
      });

      await expect(
        service.updateStatus('task-1', TaskStatus.IN_PROGRESS),
      ).rejects.toThrow(ConflictException);
    });

    it('stamps completedAt only when moving to COMPLETED', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: 'task-1',
        status: TaskStatus.PENDING,
      });
      prisma.task.update.mockResolvedValue({
        id: 'task-1',
        status: TaskStatus.COMPLETED,
      });

      await service.updateStatus('task-1', TaskStatus.COMPLETED);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('flagOverdue', () => {
    it('flips every PENDING/IN_PROGRESS task past its due date to OVERDUE', async () => {
      prisma.task.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.flagOverdue();

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          }),
          data: { status: TaskStatus.OVERDUE },
        }),
      );
      expect(count).toBe(3);
    });
  });

  describe('myTasks', () => {
    it('buckets into today/upcoming/overdue/completed', async () => {
      prisma.task.findMany
        .mockResolvedValueOnce([{ id: 'today-1' }]) // today
        .mockResolvedValueOnce([{ id: 'upcoming-1' }]) // upcoming
        .mockResolvedValueOnce([{ id: 'overdue-1' }]) // overdue
        .mockResolvedValueOnce([{ id: 'completed-1' }]); // completed

      const result = await service.myTasks('staff-1');

      expect(result).toEqual({
        today: [{ id: 'today-1' }],
        upcoming: [{ id: 'upcoming-1' }],
        overdue: [{ id: 'overdue-1' }],
        completed: [{ id: 'completed-1' }],
      });
    });
  });
});
