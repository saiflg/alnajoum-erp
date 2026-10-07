import { Injectable } from '@nestjs/common';
import { TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { ActionError } from '../engine/retry';
import { ActionContext, WorkflowAction } from './action.types';

/** Adds a line to a customer's timeline (the existing CRM 360 view). Idempotent per workflow step. */
@Injectable()
export class TimelineAction implements WorkflowAction {
  key = 'crm.timeline';
  label = 'Add to the customer timeline';
  sideEffect = 'NONE' as const;
  requiredPermissions = [PERMISSIONS.CRM.CUSTOMER_360_VIEW];

  constructor(private readonly prisma: PrismaService) {}

  validate(c: Record<string, unknown>): string[] {
    return typeof c.description === 'string' && c.description.length > 0
      ? []
      : ['description is required'];
  }

  private customerId(ctx: ActionContext): string | undefined {
    const raw = ctx.config.customerId;
    if (typeof raw === 'string' && raw) return ctx.render(raw);
    const c = (ctx.context.customer as { id?: unknown } | undefined)?.id;
    return typeof c === 'string' ? c : undefined;
  }

  async run(ctx: ActionContext) {
    const customerId = this.customerId(ctx);
    if (!customerId)
      throw new ActionError(
        'No customer to attach the timeline entry to',
        'PERMANENT',
        'NO_CUSTOMER',
      );
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!customer)
      throw new ActionError(
        'The customer does not belong to this company',
        'PERMANENT',
        'CROSS_TENANT',
      );

    const existing = await this.prisma.customerTimelineEvent.findFirst({
      where: {
        customerId,
        relatedType: 'WORKFLOW_STEP',
        relatedId: ctx.idempotencyKey,
      },
      select: { id: true },
    });
    if (existing) return { timelineEventId: existing.id, deduplicated: true };
    const row = await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        type: TimelineEventType.OTHER,
        description: ctx.render(String(ctx.config.description)),
        relatedType: 'WORKFLOW_STEP',
        relatedId: ctx.idempotencyKey,
      },
      select: { id: true },
    });
    return { timelineEventId: row.id };
  }

  mock(ctx: ActionContext) {
    return {
      wouldAddTimeline: ctx.render(String(ctx.config.description)),
      mocked: true,
    };
  }
}
