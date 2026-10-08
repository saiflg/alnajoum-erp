import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiApprovalStatus, Prisma } from '@prisma/client';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ApprovalsService } from '../../governance/approvals.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { ActionPreview, ToolDefinition } from '../agent.types';
import { maskDeep } from '../runtime/guards';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { validateInput } from '../tools/tool-support';
import { PrincipalService } from './principal.service';

export const AI_ACTION_APPROVAL_TYPE = 'AI_ACTION';

/** The permission a human needs to approve each tool's action, on top of ai:approve. */
const APPROVER_PERMISSION: Record<string, string[]> = {
  cancelFlightBooking: [PERMISSIONS.FLIGHT.CANCEL],
  requestFlightRefund: [PERMISSIONS.FLIGHT.REFUND],
  issueFlightTicket: [PERMISSIONS.FLIGHT.TICKET_ISSUE],
  adjustWalletBalance: [PERMISSIONS.WALLET.ADJUST],
  executeStaffPayout: [PERMISSIONS.VISA.PAYOUT_APPROVE],
  markPaymentVerified: [PERMISSIONS.PAYMENT.RECORD],
  postJournalEntry: [PERMISSIONS.FINANCE.ACCOUNTS_MANAGE],
  changeBankDetails: [PERMISSIONS.FINANCE.STAFF_BANK_VERIFY],
  sendNotification: [PERMISSIONS.CRM.TASK_MANAGE],
};

export interface RequestApprovalInput {
  executionId: string;
  agentId: string;
  agentKey: string;
  tool: ToolDefinition;
  input: Record<string, unknown>;
  reason: string;
  companyId: string | null;
  branchId: string | null;
  initiatorIdentityId: string | null;
  customerSummary?: string;
}

/**
 * The human approval gate. An agent that wants a medium/high-risk action does not perform it: this records the
 * request with a full preview and routes it through the EXISTING approval engine (thresholds, multiple
 * approvers, self-approval prevention). When the humans approve, the action runs under the APPROVER's identity,
 * after the approver's own permissions are checked. The agent can neither approve nor edit its own request.
 */
@Injectable()
export class AiApprovalsService {
  private readonly logger = new Logger(AiApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly engine: ApprovalsService,
    private readonly tools: ToolRegistryService,
    private readonly principals: PrincipalService,
  ) {}

  async request(a: RequestApprovalInput) {
    const preview = this.buildPreview(a);
    const amount =
      typeof a.input.amount === 'number'
        ? a.input.amount
        : typeof a.input.expectedPrice === 'number'
          ? a.input.expectedPrice
          : undefined;
    const safeParams = maskDeep(a.input) as Prisma.InputJsonValue;
    const row = await this.prisma.aiApproval.create({
      data: {
        executionId: a.executionId,
        agentId: a.agentId,
        companyId: a.companyId ?? undefined,
        branchId: a.branchId ?? undefined,
        toolKey: a.tool.key,
        risk: a.tool.risk,
        resourceType:
          typeof a.input.bookingReference === 'string'
            ? 'FlightBooking'
            : undefined,
        resourceId:
          typeof a.input.bookingReference === 'string'
            ? a.input.bookingReference
            : typeof a.input.subjectId === 'string'
              ? a.input.subjectId
              : undefined,
        reason: a.reason,
        params: safeParams,
        preview: preview as unknown as Prisma.InputJsonValue,
        financialImpact: preview.financialImpact as
          Prisma.InputJsonValue | undefined,
        customerImpact: a.customerSummary,
        requiredRole: APPROVER_PERMISSION[a.tool.key]?.join(', ') ?? 'Staff',
        initiatorIdentityId: a.initiatorIdentityId ?? undefined,
        expiresAt: new Date(Date.now() + 72 * 3600_000),
      },
    });
    // Mirror into the existing approval engine whenever there is a human requester to attribute it to.
    if (a.initiatorIdentityId) {
      const req = await this.engine.createRequest({
        type: AI_ACTION_APPROVAL_TYPE,
        amount,
        entityType: 'AiApproval',
        entityId: row.id,
        requestedByIdentityId: a.initiatorIdentityId,
        reason: `AI agent ${a.agentKey}: ${preview.action}. ${a.reason}`.slice(
          0,
          500,
        ),
        companyId: a.companyId ?? undefined,
        newState: preview as unknown as Prisma.InputJsonValue,
      });
      await this.prisma.aiApproval.update({
        where: { id: row.id },
        data: { approvalRequestId: req.id },
      });
    }
    await this.audit.record({
      identityId: a.initiatorIdentityId ?? undefined,
      companyId: a.companyId ?? undefined,
      branchId: a.branchId ?? undefined,
      action: 'ai.approval_requested',
      entityType: 'AiApproval',
      entityId: row.id,
      metadata: {
        agent: a.agentKey,
        tool: a.tool.key,
        risk: a.tool.risk,
        executionId: a.executionId,
      },
    });
    return row;
  }

  private buildPreview(a: RequestApprovalInput): ActionPreview {
    const p = a.tool.preview?.(a.input) ?? {
      action: a.tool.description,
      risks: ['This changes a business record'],
      whatWillHappen: [a.tool.description],
      requiredApproval: 'Staff approval',
    };
    return {
      ...p,
      reason: a.reason,
      affectedCustomer: a.customerSummary ?? p.affectedCustomer,
      affectedBooking:
        typeof a.input.bookingReference === 'string'
          ? a.input.bookingReference
          : p.affectedBooking,
    };
  }

  list(companyId: string | undefined, status?: AiApprovalStatus) {
    return this.prisma.aiApproval.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(status ? { status } : {}),
      },
      include: { agent: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(id: string, companyId: string | undefined) {
    const row = await this.prisma.aiApproval.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      include: {
        agent: { select: { key: true, name: true } },
        execution: {
          select: {
            id: true,
            objective: true,
            status: true,
            agentVersionId: true,
            promptVersion: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Approval not found');
    return row;
  }

  private async authorise(
    approval: { toolKey: string; initiatorIdentityId: string | null },
    user: AuthContext,
  ) {
    if (user.type !== 'STAFF')
      throw new ForbiddenException('Only staff can decide AI actions');
    const need = [
      PERMISSIONS.APPROVAL.DECIDE,
      ...(APPROVER_PERMISSION[approval.toolKey] ?? []),
    ];
    const missing = need.filter(
      (p) =>
        !user.permissions.includes(p) && !user.roles.includes('SUPER_ADMIN'),
    );
    if (missing.length)
      throw new ForbiddenException(
        `You need these permissions to decide this action: ${missing.join(', ')}`,
      );
    if (
      approval.initiatorIdentityId &&
      approval.initiatorIdentityId === user.sub
    )
      throw new ForbiddenException(
        'You cannot approve an action you started yourself',
      );
  }

  async decide(
    id: string,
    user: AuthContext,
    decision: 'APPROVE' | 'REJECT' | 'CANCEL',
    note: string | undefined,
    editedParams?: Record<string, unknown>,
  ) {
    const tenant = user.roles.includes('SUPER_ADMIN')
      ? undefined
      : (user.companyId ?? '__no_tenant__');
    const row = await this.get(id, tenant);
    if (row.status !== 'PENDING')
      throw new ConflictException(
        `This request is already ${row.status.toLowerCase()}`,
      );
    if (row.expiresAt && row.expiresAt < new Date()) {
      await this.prisma.aiApproval.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException('This request has expired');
    }

    if (decision === 'CANCEL') {
      // The person who started it, or any authorised approver, may withdraw it.
      if (row.initiatorIdentityId !== user.sub)
        await this.authorise(
          { toolKey: row.toolKey, initiatorIdentityId: null },
          user,
        );
      await this.prisma.aiApproval.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          decidedByIdentityId: user.sub,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      await this.prisma.aiExecution.updateMany({
        where: { id: row.executionId, status: 'WAITING_APPROVAL' },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
      await this.audit.record({
        identityId: user.sub,
        companyId: row.companyId ?? undefined,
        action: 'ai.approval_cancelled',
        entityType: 'AiApproval',
        entityId: id,
      });
      return this.get(id, tenant);
    }

    await this.authorise(row, user);
    const tool = this.tools.get(row.toolKey);
    if (!tool) throw new BadRequestException('That tool no longer exists');

    if (editedParams) {
      const v = validateInput(tool.input, editedParams);
      if (!v.ok)
        throw new BadRequestException(`The edit is not valid: ${v.error}`);
      await this.prisma.aiApproval.update({
        where: { id },
        data: { editedParams: maskDeep(v.value) as Prisma.InputJsonValue },
      });
      row.editedParams = v.value as Prisma.JsonValue;
    }

    if (decision === 'REJECT') {
      if (!note) throw new BadRequestException('A reason is needed to reject');
      if (row.approvalRequestId)
        await this.engine
          .decide(row.approvalRequestId, user.sub, 'REJECTED', note, tenant)
          .catch(() => undefined);
      await this.prisma.aiApproval.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedByIdentityId: user.sub,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      await this.prisma.aiExecution.updateMany({
        where: { id: row.executionId, status: 'WAITING_APPROVAL' },
        data: { status: 'REJECTED', finishedAt: new Date() },
      });
      await this.audit.record({
        identityId: user.sub,
        companyId: row.companyId ?? undefined,
        action: 'ai.approval_rejected',
        entityType: 'AiApproval',
        entityId: id,
        reason: note,
      });
      await this.tellConversation(
        row.executionId,
        'Your request was reviewed and could not be approved. A member of staff will contact you.',
      );
      return this.get(id, tenant);
    }

    // APPROVE — through the engine when there is one (it enforces thresholds, multiple approvers, self-approval).
    if (row.approvalRequestId) {
      const updated = await this.engine.decide(
        row.approvalRequestId,
        user.sub,
        'APPROVED',
        note,
        tenant,
      );
      if (updated.status !== 'APPROVED') {
        await this.audit.record({
          identityId: user.sub,
          companyId: row.companyId ?? undefined,
          action: 'ai.approval_partial',
          entityType: 'AiApproval',
          entityId: id,
        });
        return this.get(id, tenant);
      }
    }
    // Atomic claim: two approvers clicking at once execute the action once.
    const claim = await this.prisma.aiApproval.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        decidedByIdentityId: user.sub,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claim.count === 0)
      throw new ConflictException(
        'This request was just decided by someone else',
      );
    await this.audit.record({
      identityId: user.sub,
      companyId: row.companyId ?? undefined,
      action: 'ai.approval_approved',
      entityType: 'AiApproval',
      entityId: id,
      metadata: { tool: row.toolKey, edited: !!row.editedParams },
    });
    return this.execute(id, user, tenant);
  }

  /** Carries out an approved action under the approver's authority, exactly once. */
  private async execute(
    id: string,
    user: AuthContext,
    tenant: string | undefined,
  ) {
    const row = await this.get(id, tenant);
    const tool = this.tools.get(row.toolKey)!;
    let status: AiApprovalStatus = 'EXECUTED';
    let result: Prisma.InputJsonValue = {};
    let message = 'Approved.';
    if (!tool.executeOnApproval) {
      result = {
        note: 'Approved as a recommendation. The action was NOT performed by the AI; carry it out in the normal screen.',
      };
      message =
        'Your request was approved. A member of staff will complete it.';
    } else {
      try {
        const principal = await this.principals.fromAuth(user);
        const params = {
          ...(row.params as Record<string, unknown>),
          ...((row.editedParams as Record<string, unknown> | null) ?? {}),
        };
        const out = await tool.execute(
          {
            principal,
            agentKey: row.agent.key,
            executionId: row.executionId,
            correlationId: row.executionId,
            conversationId: null,
            dryRun: false,
            language: 'en',
            idempotencyKey: `approval-${row.id}`,
          },
          params,
        );
        result = (out.data ?? {}) as Prisma.InputJsonValue;
        message = `Your request was approved and completed: ${out.summary ?? 'done'}.`;
      } catch (err) {
        status = 'FAILED';
        result = { error: (err as Error).message };
        message =
          'Your request was approved but could not be completed automatically. A member of staff will follow up.';
        this.logger.warn(
          `Approved AI action ${row.toolKey} failed: ${(err as Error).message}`,
        );
      }
    }
    await this.prisma.aiApproval.update({
      where: { id },
      data: { status, executedAt: new Date(), result },
    });
    await this.prisma.aiExecution.updateMany({
      where: {
        id: row.executionId,
        status: { in: ['WAITING_APPROVAL', 'RUNNING'] },
      },
      data: {
        status: status === 'EXECUTED' ? 'COMPLETED' : 'FAILED',
        finishedAt: new Date(),
        error: status === 'FAILED' ? 'Approved action failed' : undefined,
      },
    });
    await this.audit.record({
      identityId: user.sub,
      companyId: row.companyId ?? undefined,
      action: status === 'EXECUTED' ? 'ai.action_executed' : 'ai.action_failed',
      entityType: 'AiApproval',
      entityId: id,
      metadata: { tool: row.toolKey, executionId: row.executionId },
    });
    await this.tellConversation(row.executionId, message);
    return this.get(id, tenant);
  }

  /** Puts the outcome in the customer's conversation, so they hear back without asking. */
  private async tellConversation(executionId: string, content: string) {
    const ex = await this.prisma.aiExecution.findUnique({
      where: { id: executionId },
      select: { conversationId: true, language: true },
    });
    if (!ex?.conversationId) return;
    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: ex.conversationId,
        role: 'SYSTEM',
        content,
        language: ex.language,
        executionId,
      },
    });
    await this.prisma.aiConversation.update({
      where: { id: ex.conversationId },
      data: { lastMessageAt: new Date() },
    });
  }
}
