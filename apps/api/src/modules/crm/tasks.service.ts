import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TaskPriority, TaskRelatedType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTaskDto } from './dto/create-task.dto';

/**
 * Covers both spec #7 (Follow-Up System) and spec #8 (Staff Task
 * Management) — see Task's doc comment in schema.prisma. Spec #9's
 * automatic task creation lives in CrmAutomationService, which calls
 * `createAuto()` here rather than duplicating the create/notify logic.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateTaskDto, createdByStaffId?: string) {
    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        relatedType: dto.relatedType,
        relatedId: dto.relatedId,
        customerId: dto.customerId,
        leadId: dto.leadId,
        assignedStaffId: dto.assignedStaffId,
        dueDate: new Date(dto.dueDate),
        priority: dto.priority,
        notes: dto.notes,
        createdByStaffId,
      },
    });
    await this.auditService.record({
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      metadata: {
        assignedStaffId: dto.assignedStaffId,
        relatedType: dto.relatedType,
      },
    });
    return task;
  }

  /** Spec #9 — same shape as create(), just flagged isAutoCreated and never fails the caller (see CrmAutomationService's try/catch around every call site). */
  async createAuto(params: {
    title: string;
    description?: string;
    relatedType: TaskRelatedType;
    relatedId?: string;
    customerId?: string;
    assignedStaffId: string;
    dueDate: Date;
    priority?: TaskPriority;
  }) {
    // Idempotent: never create a second identical auto-task for the same
    // relatedType/relatedId that's still open, so a daily sweep doesn't
    // pile up duplicates for an issue nobody has actioned yet.
    if (params.relatedId) {
      const existing = await this.prisma.task.findFirst({
        where: {
          relatedType: params.relatedType,
          relatedId: params.relatedId,
          isAutoCreated: true,
          status: {
            in: [
              TaskStatus.PENDING,
              TaskStatus.IN_PROGRESS,
              TaskStatus.OVERDUE,
            ],
          },
        },
      });
      if (existing) return existing;
    }
    return this.prisma.task.create({
      data: { ...params, isAutoCreated: true },
    });
  }

  listAll(filters: {
    assignedStaffId?: string;
    status?: TaskStatus;
    customerId?: string;
    leadId?: string;
    relatedType?: TaskRelatedType;
  }) {
    return this.prisma.task.findMany({
      where: filters,
      include: {
        assignedStaff: { select: { firstName: true, lastName: true } },
        customer: { select: { firstName: true, lastName: true } },
        lead: { select: { leadNumber: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /** Spec #8's "My Tasks" grouping — today / upcoming / overdue / completed. */
  async myTasks(staffId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [today, upcoming, overdue, completed] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          assignedStaffId: staffId,
          dueDate: { gte: startOfToday, lte: endOfToday },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.task.findMany({
        where: {
          assignedStaffId: staffId,
          dueDate: { gt: endOfToday },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      this.prisma.task.findMany({
        where: {
          assignedStaffId: staffId,
          dueDate: { lt: startOfToday },
          status: {
            in: [
              TaskStatus.PENDING,
              TaskStatus.IN_PROGRESS,
              TaskStatus.OVERDUE,
            ],
          },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { assignedStaffId: staffId, status: TaskStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
        take: 30,
      }),
    ]);

    return { today, upcoming, overdue, completed };
  }

  async get(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async updateStatus(id: string, status: TaskStatus) {
    const task = await this.get(id);
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw new ConflictException(
        `This task is already ${task.status.toLowerCase()}`,
      );
    }
    return this.prisma.task.update({
      where: { id },
      data: {
        status,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  /** Flips PENDING/IN_PROGRESS tasks whose due date has passed to OVERDUE — called from CrmAutomationService's daily sweep. */
  async flagOverdue(): Promise<number> {
    const result = await this.prisma.task.updateMany({
      where: {
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        dueDate: { lt: new Date() },
      },
      data: { status: TaskStatus.OVERDUE },
    });
    return result.count;
  }
}
