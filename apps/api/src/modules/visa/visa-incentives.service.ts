import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IncentivePolicy,
  IncentiveStatus,
  VisaApplication,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { calculateStaffIncentiveAmount } from '../incentives/incentive-calculator';
import { NotificationsService } from '../notifications/notifications.service';

function generateIncentiveReference(): string {
  return `INC-${randomBytes(4).toString('hex').toUpperCase()}`;
}

// Re-exported for backward compatibility — every existing import of this
// function from visa-incentives.service.ts (including
// visa-incentives.service.spec.ts) keeps working unchanged. The
// implementation itself now lives in incentives/incentive-calculator.ts so
// Phase 4's flight incentives can reuse the exact same math instead of
// duplicating it (see FlightIncentivesService).
export { calculateStaffIncentiveAmount };

@Injectable()
export class VisaIncentivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolvePolicy(
    application: VisaApplication,
  ): Promise<IncentivePolicy | null> {
    if (application.visaServiceId) {
      const service = await this.prisma.visaService.findUnique({
        where: { id: application.visaServiceId },
        include: { incentivePolicy: true },
      });
      if (service?.incentivePolicy?.isActive) {
        return service.incentivePolicy;
      }
    }
    // Fall back to the platform-wide default policy, if an admin configured
    // one — never invent a policy out of thin air (see
    // calculateStaffIncentiveAmount's doc comment).
    return this.prisma.incentivePolicy.findFirst({
      where: { isDefault: true, isActive: true },
    });
  }

  /**
   * Called once a visa application reaches COMPLETED with a fully-paid
   * invoice (see VisaService.completeApplication in visa.service.ts).
   * Idempotent: does nothing if an incentive already exists for this
   * application, since a status can't move to COMPLETED twice (see
   * TERMINAL_STATUSES in visa.service.ts) — safe to call defensively.
   */
  async createForCompletedApplication(
    application: VisaApplication,
  ): Promise<void> {
    const staffId = application.assignedStaffId ?? application.appliedByStaffId;
    if (!staffId) {
      return; // Self-service application with no staff involved — nobody to credit.
    }
    if (
      application.companyCostSnapshot == null ||
      application.sellingPriceSnapshot == null
    ) {
      return; // Not linked to a VisaService catalog entry — no costing to compute a margin from.
    }

    const existing = await this.prisma.staffIncentive.findFirst({
      where: { sourceType: 'VISA_APPLICATION', sourceId: application.id },
    });
    if (existing) {
      return;
    }

    const margin =
      application.sellingPriceSnapshot - application.companyCostSnapshot;
    const policy = await this.resolvePolicy(application);
    const amount = calculateStaffIncentiveAmount(margin, policy);
    if (amount <= 0) {
      return;
    }

    const incentive = await this.prisma.staffIncentive.create({
      data: {
        staffId,
        sourceType: 'VISA_APPLICATION',
        sourceId: application.id,
        amount,
        currency: application.currency,
        description: `Incentive on visa application ${application.applicationReference}`,
        status: IncentiveStatus.PENDING,
        referenceNumber: generateIncentiveReference(),
        companyCost: application.companyCostSnapshot,
        sellingPrice: application.sellingPriceSnapshot,
        margin,
        policyId: policy?.id,
        customerId: application.customerId,
      },
    });

    await this.auditService.record({
      action: 'visa_incentive.created',
      entityType: 'StaffIncentive',
      entityId: incentive.id,
      metadata: {
        applicationId: application.id,
        staffId,
        amount,
        margin,
        policyType: policy?.type ?? null,
      },
    });

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      include: { identity: { select: { id: true, email: true } } },
    });
    if (staff) {
      await this.notificationsService.sendIncentiveUpdate(
        staff.identity.email,
        staff.identity.id,
        {
          referenceNumber: incentive.referenceNumber ?? incentive.id,
          amount,
          currency: incentive.currency,
          status: 'GENERATED',
        },
      );
    }
  }

  listAll(filters: { staffId?: string; status?: IncentiveStatus }) {
    return this.prisma.staffIncentive.findMany({
      where: filters,
      include: {
        staff: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        customer: { select: { firstName: true, lastName: true } },
        payout: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForStaff(staffId: string) {
    return this.prisma.staffIncentive.findMany({
      where: { staffId },
      include: { payout: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const incentive = await this.prisma.staffIncentive.findUnique({
      where: { id },
      include: {
        staff: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        customer: { select: { firstName: true, lastName: true } },
        payout: true,
      },
    });
    if (!incentive) {
      throw new NotFoundException('Incentive not found');
    }
    return incentive;
  }

  async approve(id: string, approvedByStaffId: string) {
    const incentive = await this.get(id);
    if (incentive.status !== IncentiveStatus.PENDING) {
      throw new ConflictException(
        `This incentive is already ${incentive.status.toLowerCase()} and cannot be approved`,
      );
    }
    const updated = await this.prisma.staffIncentive.update({
      where: { id },
      data: {
        status: IncentiveStatus.APPROVED,
        approvedByStaffId,
        approvedAt: new Date(),
      },
    });
    await this.auditService.record({
      action: 'visa_incentive.approved',
      entityType: 'StaffIncentive',
      entityId: id,
      metadata: { approvedByStaffId },
    });

    const staff = await this.prisma.staff.findUnique({
      where: { id: incentive.staffId },
      include: { identity: { select: { id: true, email: true } } },
    });
    if (staff) {
      await this.notificationsService.sendIncentiveUpdate(
        staff.identity.email,
        staff.identity.id,
        {
          referenceNumber: incentive.referenceNumber ?? incentive.id,
          amount: incentive.amount,
          currency: incentive.currency,
          status: 'APPROVED',
        },
      );
    }
    return updated;
  }

  async reject(id: string, reason: string, actorIdentityId?: string) {
    const incentive = await this.get(id);
    if (incentive.status !== IncentiveStatus.PENDING) {
      throw new ConflictException(
        `This incentive is already ${incentive.status.toLowerCase()} and cannot be rejected`,
      );
    }
    const updated = await this.prisma.staffIncentive.update({
      where: { id },
      data: { status: IncentiveStatus.REJECTED, rejectionReason: reason },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'visa_incentive.rejected',
      entityType: 'StaffIncentive',
      entityId: id,
      metadata: { reason },
    });
    return updated;
  }
}
