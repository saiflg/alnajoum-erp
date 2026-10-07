import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { ActionContext, WorkflowAction } from './action.types';

/** Writes a line to the audit log, attributed to the workflow. Useful as a visible milestone in a flow. */
@Injectable()
export class AuditNoteAction implements WorkflowAction {
  key = 'audit.note';
  label = 'Record an audit note';
  sideEffect = 'NONE' as const;
  requiredPermissions = [PERMISSIONS.WORKFLOW.VIEW];

  constructor(private readonly audit: AuditService) {}

  validate(c: Record<string, unknown>): string[] {
    return typeof c.note === 'string' && c.note.length > 0
      ? []
      : ['note is required'];
  }

  async run(ctx: ActionContext) {
    await this.audit.record({
      action: 'workflow.note',
      entityType: 'WorkflowExecution',
      entityId: ctx.executionId,
      companyId: ctx.companyId,
      branchId: ctx.branchId ?? undefined,
      reason: ctx.render(String(ctx.config.note)),
      metadata: { nodeId: ctx.nodeId },
    });
    return { recorded: true };
  }

  mock(ctx: ActionContext) {
    return { wouldRecord: ctx.render(String(ctx.config.note)), mocked: true };
  }
}
