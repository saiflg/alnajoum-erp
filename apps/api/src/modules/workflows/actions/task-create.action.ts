import { Injectable } from '@nestjs/common';
import { TaskPriority, TaskRelatedType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TasksService } from '../../crm/tasks.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { ActionError } from '../engine/retry';
import { ActionContext, WorkflowAction } from './action.types';

const RELATED = Object.values(TaskRelatedType) as string[];
const PRIORITIES = Object.values(TaskPriority) as string[];
const isStr = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

/**
 * Creates a staff task. Tasks have no company column, so tenancy is enforced HERE:
 * the assignee must be an active staff member of the workflow's own company, and
 * a role-based assignment only searches that company (and the event's branch, when
 * it has one). A task is never created for another tenant's staff.
 */
@Injectable()
export class TaskCreateAction implements WorkflowAction {
  key = 'task.create';
  label = 'Create a staff task';
  sideEffect = 'NONE' as const;
  requiredPermissions = [PERMISSIONS.CRM.TASK_MANAGE];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  validate(c: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!isStr(c.title)) errors.push('title is required');
    if (
      c.relatedType !== undefined &&
      !RELATED.includes(c.relatedType as string)
    )
      errors.push(`relatedType must be one of ${RELATED.join(', ')}`);
    if (c.priority !== undefined && !PRIORITIES.includes(c.priority as string))
      errors.push(`priority must be one of ${PRIORITIES.join(', ')}`);
    if (
      c.dueInHours !== undefined &&
      !(
        typeof c.dueInHours === 'number' &&
        c.dueInHours > 0 &&
        c.dueInHours <= 24 * 90
      )
    )
      errors.push('dueInHours must be a number from 1 to 2160');
    const a = c.assignTo as
      { mode?: string; staffId?: unknown; role?: unknown } | undefined;
    if (!a || !['STAFF', 'ROLE', 'CUSTOMER_OWNER'].includes(String(a.mode)))
      errors.push('assignTo.mode must be STAFF, ROLE or CUSTOMER_OWNER');
    else if (a.mode === 'STAFF' && !isStr(a.staffId))
      errors.push('assignTo.staffId is required for mode STAFF');
    else if (a.mode === 'ROLE' && !isStr(a.role))
      errors.push('assignTo.role is required for mode ROLE');
    return errors;
  }

  private async resolveAssignee(ctx: ActionContext): Promise<string> {
    const a = ctx.config.assignTo as {
      mode: string;
      staffId?: string;
      role?: string;
    };
    const inCompany = { companyId: ctx.companyId, isActive: true };
    if (a.mode === 'STAFF') {
      const s = await this.prisma.staff.findFirst({
        where: { id: a.staffId, ...inCompany },
        select: { id: true },
      });
      if (!s)
        throw new ActionError(
          'The assigned staff member does not exist in this company or is inactive',
          'PERMANENT',
          'ASSIGNEE_NOT_FOUND',
        );
      return s.id;
    }
    if (a.mode === 'CUSTOMER_OWNER') {
      const customerId = this.customerId(ctx);
      const c = customerId
        ? await this.prisma.customer.findFirst({
            where: { id: customerId, companyId: ctx.companyId },
            select: { assignedStaffId: true },
          })
        : null;
      if (!c?.assignedStaffId)
        throw new ActionError(
          'The customer has no assigned staff member',
          'PERMANENT',
          'ASSIGNEE_NOT_FOUND',
        );
      return c.assignedStaffId;
    }
    const s = await this.prisma.staff.findFirst({
      where: {
        ...inCompany,
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        identity: { roles: { some: { role: { name: a.role } } } },
      },
      orderBy: { employeeCode: 'asc' },
      select: { id: true },
    });
    if (!s)
      throw new ActionError(
        `No active ${a.role} found${ctx.branchId ? " in the event's branch" : ''}`,
        'PERMANENT',
        'ASSIGNEE_NOT_FOUND',
      );
    return s.id;
  }

  private customerId(ctx: ActionContext): string | undefined {
    const raw = ctx.config.customerId;
    if (isStr(raw)) return ctx.render(raw);
    const c = (ctx.context.customer as { id?: unknown } | undefined)?.id;
    return isStr(c) ? c : undefined;
  }

  async run(ctx: ActionContext) {
    const assignedStaffId = await this.resolveAssignee(ctx);
    const customerId = this.customerId(ctx);
    if (customerId) {
      const ok = await this.prisma.customer.findFirst({
        where: { id: customerId, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!ok)
        throw new ActionError(
          'The customer does not belong to this company',
          'PERMANENT',
          'CROSS_TENANT',
        );
    }
    const task = await this.tasks.createAuto({
      title: ctx.render(String(ctx.config.title)),
      description: isStr(ctx.config.description)
        ? ctx.render(ctx.config.description)
        : undefined,
      relatedType:
        (ctx.config.relatedType as TaskRelatedType | undefined) ??
        TaskRelatedType.OTHER,
      // The step key doubles as the task's dedupe key, so a re-run finds the open task instead of adding another.
      relatedId: ctx.idempotencyKey,
      customerId,
      assignedStaffId,
      dueDate: new Date(
        Date.now() +
          ((ctx.config.dueInHours as number | undefined) ?? 24) * 3_600_000,
      ),
      priority:
        (ctx.config.priority as TaskPriority | undefined) ??
        TaskPriority.NORMAL,
    });
    return { taskId: task.id, assignedStaffId };
  }

  mock(ctx: ActionContext) {
    return {
      wouldCreateTask: ctx.render(String(ctx.config.title)),
      assignTo: ctx.config.assignTo,
      mocked: true,
    };
  }
}
