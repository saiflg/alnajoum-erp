import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalDecisionType,
  ApprovalRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface OpenApprovalRequestInput {
  type: string;
  amount?: number;
  currency?: string;
  entityType?: string;
  entityId?: string;
  requestedByIdentityId: string;
  reason?: string;
  companyId?: string;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
}

/**
 * Phase 11 spec #10/#11 — a reusable, generic approval workflow any
 * module can route a sensitive action through. Does NOT replace the
 * narrower approval patterns that already work in this codebase
 * (ManualPaymentSubmission's finance review, Phase 10's manual-booking
 * approval gate, StaffIncentive's own lifecycle) — see the schema's own
 * doc comment on ApprovalRequest for why those stay as they are. This is
 * for call sites that need configurable, amount-based, multi-level
 * approval with self-approval prevention, which nothing existing
 * provides.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Most-specific-wins, same resolution pattern used throughout this
   * codebase (FlightPricingRule, CountryVisaRule, FlightProviderRoutingRule):
   * a company-scoped rule beats the platform-wide default (companyId
   * null) when both match this type/amount band. No matching rule at all
   * means "one approval" — never zero, since that would make a request
   * that's supposed to need sign-off self-approve on creation.
   */
  async resolveRequiredApprovals(
    type: string,
    amount: number | undefined,
    companyId?: string,
  ): Promise<number> {
    if (amount === undefined) return 1;

    const rules = await this.prisma.approvalThresholdRule.findMany({
      where: {
        type,
        isActive: true,
        minAmount: { lte: amount },
        AND: [
          { OR: [{ maxAmount: null }, { maxAmount: { gte: amount } }] },
          companyId
            ? { OR: [{ companyId }, { companyId: null }] }
            : { companyId: null },
        ],
      },
    });
    if (rules.length === 0) return 1;

    const companyScoped = rules.find(
      (r) => r.companyId === companyId && companyId,
    );
    return (companyScoped ?? rules[0]).requiredApprovals;
  }

  async createRequest(input: OpenApprovalRequestInput) {
    const requiredApprovals = await this.resolveRequiredApprovals(
      input.type,
      input.amount,
      input.companyId,
    );

    const request = await this.prisma.approvalRequest.create({
      data: {
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        entityType: input.entityType,
        entityId: input.entityId,
        requestedByIdentityId: input.requestedByIdentityId,
        reason: input.reason,
        companyId: input.companyId,
        previousState: input.previousState,
        newState: input.newState,
        requiredApprovals,
      },
    });

    await this.auditService.record({
      identityId: input.requestedByIdentityId,
      action: 'approval.requested',
      entityType: 'ApprovalRequest',
      entityId: request.id,
      companyId: input.companyId,
      metadata: {
        type: input.type,
        amount: input.amount,
        requiredApprovals,
      },
    });

    return request;
  }

  async findOne(id: string, tenantCompanyId?: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { email: true } },
        decisions: {
          include: { decidedBy: { select: { email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (
      !request ||
      (tenantCompanyId !== undefined && request.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Approval request not found');
    }
    return request;
  }

  async list(
    filters: { status?: ApprovalRequestStatus; type?: string },
    tenantCompanyId?: string,
  ) {
    return this.prisma.approvalRequest.findMany({
      where: {
        ...filters,
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      include: {
        requestedBy: { select: { email: true } },
        decisions: { select: { decision: true, decidedByIdentityId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every request the caller made themselves — always visible to them
   * regardless of the APPROVAL.VIEW permission, same as any module lets a
   * requester see their own request's status. */
  async listMine(requestedByIdentityId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { requestedByIdentityId },
      include: {
        decisions: { select: { decision: true, decidedByIdentityId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Spec #11's core security rule — a decider is never the requester.
   * A single REJECTED decision stops the request immediately (matching
   * how most real approval chains work); APPROVED decisions accumulate
   * until requiredApprovals is met, at which point (and only then) the
   * request flips to APPROVED.
   */
  async decide(
    requestId: string,
    decidedByIdentityId: string,
    decision: ApprovalDecisionType,
    reason: string | undefined,
    tenantCompanyId?: string,
  ) {
    const request = await this.findOne(requestId, tenantCompanyId);

    if (
      request.status === ApprovalRequestStatus.APPROVED ||
      request.status === ApprovalRequestStatus.REJECTED
    ) {
      throw new ConflictException('This approval request is already resolved');
    }
    if (request.requestedByIdentityId === decidedByIdentityId) {
      throw new ForbiddenException(
        'You cannot approve or reject your own request',
      );
    }
    if (decision === ApprovalDecisionType.REJECTED && !reason) {
      throw new BadRequestException('A reason is required to reject a request');
    }
    if (
      request.decisions.some(
        (d) => d.decidedByIdentityId === decidedByIdentityId,
      )
    ) {
      throw new ConflictException('You have already decided on this request');
    }

    await this.prisma.approvalDecision.create({
      data: {
        approvalRequestId: requestId,
        decidedByIdentityId,
        decision,
        reason,
      },
    });

    const previousStatus = request.status;
    let newStatus: ApprovalRequestStatus;
    if (decision === ApprovalDecisionType.REJECTED) {
      newStatus = ApprovalRequestStatus.REJECTED;
    } else {
      const approvedCount =
        request.decisions.filter(
          (d) => d.decision === ApprovalDecisionType.APPROVED,
        ).length + 1;
      newStatus =
        approvedCount >= request.requiredApprovals
          ? ApprovalRequestStatus.APPROVED
          : ApprovalRequestStatus.UNDER_REVIEW;
    }

    const resolved =
      newStatus === ApprovalRequestStatus.APPROVED ||
      newStatus === ApprovalRequestStatus.REJECTED;

    const updated = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: newStatus, resolvedAt: resolved ? new Date() : null },
    });

    await this.auditService.record({
      identityId: decidedByIdentityId,
      action:
        decision === ApprovalDecisionType.REJECTED
          ? 'approval.rejected'
          : 'approval.decision_recorded',
      entityType: 'ApprovalRequest',
      entityId: requestId,
      companyId: request.companyId ?? undefined,
      reason,
      previousValue: { status: previousStatus },
      newValue: { status: newStatus },
    });

    return updated;
  }
}
