import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ApprovalRequestStatus,
  SupplierOnboardingStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../governance/approvals.service';

export const SUPPLIER_ACTIVATION_APPROVAL_TYPE = 'SUPPLIER_ACTIVATION';
export const SUPPLIER_ENTITY_TYPE = 'Supplier';

const S = SupplierOnboardingStatus;

/** Spec #3's exact forward order — DRAFT through ACTIVE. TERMINATED is
 * reachable from anywhere (an onboarding can always be abandoned) and
 * SUSPENDED/reactivation only make sense once already ACTIVE — those are
 * handled as separate special cases in isValidTransition() below rather
 * than being part of this straight line. */
const FORWARD_ORDER: SupplierOnboardingStatus[] = [
  S.DRAFT,
  S.INVITED,
  S.INFORMATION_SUBMITTED,
  S.KYC_REVIEW,
  S.DOCUMENT_REVIEW,
  S.COMMERCIAL_REVIEW,
  S.FINANCE_REVIEW,
  S.ADMIN_APPROVAL,
  S.ACTIVE,
];

function isValidTransition(
  from: SupplierOnboardingStatus,
  to: SupplierOnboardingStatus,
): boolean {
  if (to === S.TERMINATED) return from !== S.TERMINATED;
  if (from === S.ACTIVE && to === S.SUSPENDED) return true;
  if (from === S.SUSPENDED && to === S.ACTIVE) return true; // reactivation
  // ADMIN_APPROVAL -> ACTIVE is deliberately EXCLUDED here even though
  // it's the next step in FORWARD_ORDER — that specific move must only
  // ever happen via runApprovalSweep() after a real ApprovalDecision, via
  // a direct Prisma update that bypasses this function entirely. Allowing
  // it through here would let anyone with SUPPLIER.APPROVE self-activate
  // a supplier by calling transition() twice, skipping the approval
  // requirement ADMIN_APPROVAL exists to enforce.
  if (from === S.ADMIN_APPROVAL && to === S.ACTIVE) return false;
  const fromIndex = FORWARD_ORDER.indexOf(from);
  const toIndex = FORWARD_ORDER.indexOf(to);
  // Strictly the next step — no skipping stages, no moving backward.
  return fromIndex !== -1 && toIndex === fromIndex + 1;
}

/**
 * Phase 16 spec #3 — the onboarding/KYC workflow's status transitions.
 * Kept separate from SuppliersService (plain CRUD) since this is where the
 * actual business-rule enforcement (valid transition order) and the
 * approval-engine integration live. Reuses ApprovalsService/ApprovalRequest
 * exactly as FlightRefundsService does for FLIGHT_REFUND — see that
 * service's own doc comment for the pattern this mirrors: open a request at
 * the ADMIN_APPROVAL step, then a cron sweep (below) executes the decision
 * once made, since the generic approval engine has no callback mechanism.
 */
@Injectable()
export class SupplierOnboardingService {
  private readonly logger = new Logger(SupplierOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  async transition(
    supplierId: string,
    toStatus: SupplierOnboardingStatus,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
    reason?: string,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Supplier not found');
    }
    if (!isValidTransition(supplier.onboardingStatus, toStatus)) {
      throw new BadRequestException(
        `Cannot move a supplier from ${supplier.onboardingStatus} to ${toStatus}`,
      );
    }

    // Entering ADMIN_APPROVAL opens a real approval request rather than
    // just recording the status — spec #3's whole point for this step.
    // The status itself doubles as the "still pending" marker the sweep
    // below polls for, same as FlightRefund.status === REQUESTED does.
    if (toStatus === S.ADMIN_APPROVAL) {
      const updated = await this.prisma.supplier.update({
        where: { id: supplierId },
        data: { onboardingStatus: toStatus },
      });
      const approvalRequest = await this.approvalsService.createRequest({
        type: SUPPLIER_ACTIVATION_APPROVAL_TYPE,
        entityType: SUPPLIER_ENTITY_TYPE,
        entityId: supplierId,
        requestedByIdentityId: actorIdentityId,
        companyId: supplier.companyId,
        reason,
      });
      await this.auditService.record({
        identityId: actorIdentityId,
        action: 'supplier.activation_requested',
        entityType: 'Supplier',
        entityId: supplierId,
        companyId: supplier.companyId,
        reason,
        metadata: { approvalRequestId: approvalRequest.id },
      });
      return updated;
    }

    const updated = await this.prisma.supplier.update({
      where: { id: supplierId },
      data: { onboardingStatus: toStatus },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.onboarding_transitioned',
      entityType: 'Supplier',
      entityId: supplierId,
      companyId: supplier.companyId,
      reason,
      previousValue: { onboardingStatus: supplier.onboardingStatus },
      newValue: { onboardingStatus: toStatus },
    });
    return updated;
  }

  /**
   * Mirrors FlightRefundsService.runApprovedRefundSweep() exactly — polls
   * for SUPPLIER_ACTIVATION requests a decision has resolved, and executes
   * (flip to ACTIVE) or reverts (bounce back to FINANCE_REVIEW so staff can
   * address whatever the rejection reason was) the transition they gate.
   * Every candidate is independently try/caught so one bad row never
   * blocks the rest.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runApprovalSweep(): Promise<{
    considered: number;
    activated: number;
    bouncedBack: number;
    failed: number;
  }> {
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        type: SUPPLIER_ACTIVATION_APPROVAL_TYPE,
        entityType: SUPPLIER_ENTITY_TYPE,
        status: {
          in: [ApprovalRequestStatus.APPROVED, ApprovalRequestStatus.REJECTED],
        },
      },
      select: { status: true, entityId: true },
    });

    const supplierIds = requests
      .map((r) => r.entityId)
      .filter((id): id is string => !!id);
    const pendingSuppliers =
      supplierIds.length === 0
        ? []
        : await this.prisma.supplier.findMany({
            where: {
              id: { in: supplierIds },
              onboardingStatus: S.ADMIN_APPROVAL,
            },
            select: { id: true },
          });
    const pendingIds = new Set(pendingSuppliers.map((s) => s.id));

    let activated = 0;
    let bouncedBack = 0;
    let failed = 0;

    for (const request of requests) {
      if (!request.entityId || !pendingIds.has(request.entityId)) continue;
      try {
        const toStatus =
          request.status === ApprovalRequestStatus.APPROVED
            ? S.ACTIVE
            : S.FINANCE_REVIEW;
        await this.prisma.supplier.update({
          where: { id: request.entityId },
          data: { onboardingStatus: toStatus },
        });
        await this.auditService.record({
          action:
            request.status === ApprovalRequestStatus.APPROVED
              ? 'supplier.activated'
              : 'supplier.activation_rejected',
          entityType: 'Supplier',
          entityId: request.entityId,
        });
        if (toStatus === S.ACTIVE) activated += 1;
        else bouncedBack += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Supplier activation sweep skipped ${request.entityId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const summary = {
      considered: pendingIds.size,
      activated,
      bouncedBack,
      failed,
    };
    if (pendingIds.size > 0) {
      this.logger.log(
        `Supplier activation sweep complete: ${JSON.stringify(summary)}`,
      );
    }
    return summary;
  }
}
