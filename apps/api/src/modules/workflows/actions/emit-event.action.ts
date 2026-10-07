import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { WorkflowEventBus } from '../events/workflow-event-bus.service';
import { ActionContext, WorkflowAction } from './action.types';
import { readPath } from '../engine/conditions';

/**
 * Publishes a custom event so one workflow can start another. The event carries THIS
 * execution's chain, so A → B → A is stopped by the loop guard rather than looping, and
 * the same correlation id, so the whole cascade is one trace. Only `custom.*` event
 * types are allowed: a workflow cannot impersonate a real domain event such as
 * payment.succeeded.
 */
@Injectable()
export class EmitEventAction implements WorkflowAction {
  key = 'event.emit';
  label = 'Start other workflows (emit a custom event)';
  sideEffect = 'NONE' as const;
  requiredPermissions = [PERMISSIONS.WORKFLOW.CREATE];

  constructor(private readonly bus: WorkflowEventBus) {}

  validate(c: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (typeof c.type !== 'string' || !/^custom\.[a-z][a-z0-9_]*$/.test(c.type))
      errors.push(
        'type must look like custom.refund_review (only custom.* events can be emitted)',
      );
    if (
      c.copy !== undefined &&
      (!Array.isArray(c.copy) || c.copy.some((k) => typeof k !== 'string'))
    )
      errors.push('copy must be a list of context paths');
    return errors;
  }

  /** Only the listed context paths travel with the event — never the whole context. */
  private payload(ctx: ActionContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const path of (ctx.config.copy as string[] | undefined) ?? []) {
      const v = readPath(ctx.context, path);
      if (v !== undefined) {
        const [head, ...rest] = path.split('.');
        let cur = out;
        let key = head;
        for (const seg of rest) {
          cur[key] = cur[key] ?? {};
          cur = cur[key] as Record<string, unknown>;
          key = seg;
        }
        cur[key] = v;
      }
    }
    return out;
  }

  async run(ctx: ActionContext) {
    const entity = ctx.context.event as
      { entityType?: string; entityId?: string } | undefined;
    const res = await this.bus.publish({
      type: String(ctx.config.type),
      source: 'workflows',
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      entityType: entity?.entityType,
      entityId: entity?.entityId,
      payload: this.payload(ctx),
      correlationId: ctx.correlationId,
      chain: ctx.chain,
      dedupeKey: `emit:${ctx.idempotencyKey}`,
    });
    return { eventId: res.eventId, duplicate: res.duplicate };
  }

  mock(ctx: ActionContext) {
    return {
      wouldEmit: ctx.config.type,
      payload: this.payload(ctx),
      mocked: true,
    };
  }
}
