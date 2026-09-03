import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IncentiveStatus, PayoutStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { STAFF_PAYOUT_PROVIDER } from './providers/staff-payout-provider.port';
import type { StaffPayoutProviderPort } from './providers/staff-payout-provider.port';

function generatePayoutReference(): string {
  return `PAYOUT-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Turns an APPROVED StaffIncentive into money moved, following the exact
 * ten-step flow the spec lays out: verify bank details, check the
 * incentive is actually payable, create the PENDING payout row, call the
 * provider, and only mark SUCCESSFUL once the provider confirms — a
 * failure never deletes the money owed, it just leaves the incentive
 * approved (payable again) and the payout row FAILED with the provider's
 * error attached, ready for an authorized retry.
 */
@Injectable()
export class StaffPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    @Inject(STAFF_PAYOUT_PROVIDER)
    private readonly provider: StaffPayoutProviderPort,
  ) {}

  /**
   * Steps 1-4: validate, create the PENDING row, and hand off to the
   * provider. Runs the provider call (which may be slow / a real network
   * request in a future real integration) outside the DB transaction that
   * created the PENDING row, then updates the outcome in a second write —
   * matches how PaymentsService.finalizeCheckout separates "record the
   * attempt" from "resolve the attempt" for the same reason.
   */
  async attemptPayout(incentiveId: string, requestedByStaffId: string) {
    const incentive = await this.prisma.staffIncentive.findUnique({
      where: { id: incentiveId },
      include: { staff: true, payout: true },
    });
    if (!incentive) {
      throw new NotFoundException('Incentive not found');
    }
    if (incentive.status !== IncentiveStatus.APPROVED) {
      throw new ConflictException(
        `This incentive is ${incentive.status.toLowerCase()}, not approved — it must be approved before it can be paid out`,
      );
    }
    if (incentive.payout?.status === PayoutStatus.SUCCESSFUL) {
      throw new ConflictException('This incentive has already been paid out');
    }

    const { staff } = incentive;
    if (!staff.bankName || !staff.bankAccountNumber || !staff.bankAccountName) {
      throw new BadRequestException(
        `${staff.firstName} ${staff.lastName} has no bank details on file — add them before requesting a payout`,
      );
    }

    // Reuse the existing payout row on retry rather than creating a second
    // one — StaffPayout.incentiveId is unique, so a fresh create() would
    // fail on retry anyway; this makes that the intended path rather than
    // an error case.
    const payout = await this.prisma.staffPayout.upsert({
      where: { incentiveId },
      create: {
        incentiveId,
        staffId: staff.id,
        amount: incentive.amount,
        currency: incentive.currency,
        status: PayoutStatus.PENDING,
        provider: 'mock',
        requestedByStaffId,
      },
      update: {
        status: PayoutStatus.PENDING,
        providerError: null,
        requestedByStaffId,
      },
    });

    await this.auditService.record({
      action: 'staff_payout.requested',
      entityType: 'StaffPayout',
      entityId: payout.id,
      metadata: { requestedByStaffId, incentiveId, amount: incentive.amount },
    });

    const result = await this.provider.sendPayout({
      amount: incentive.amount,
      currency: incentive.currency,
      bankName: staff.bankName,
      bankAccountNumber: staff.bankAccountNumber,
      bankAccountName: staff.bankAccountName,
      reference: generatePayoutReference(),
    });

    if (result.success) {
      const [updatedPayout] = await this.prisma.$transaction([
        this.prisma.staffPayout.update({
          where: { id: payout.id },
          data: {
            status: PayoutStatus.SUCCESSFUL,
            providerReference: result.providerReference,
            providerError: null,
          },
        }),
        this.prisma.staffIncentive.update({
          where: { id: incentiveId },
          data: { status: IncentiveStatus.PAID },
        }),
      ]);

      await this.auditService.record({
        action: 'staff_payout.succeeded',
        entityType: 'StaffPayout',
        entityId: payout.id,
        metadata: { providerReference: result.providerReference },
      });

      const identity = await this.staffIdentity(staff.id);
      if (identity) {
        await this.notificationsService.sendIncentiveUpdate(
          identity.email,
          identity.id,
          {
            referenceNumber: incentive.referenceNumber ?? incentive.id,
            amount: incentive.amount,
            currency: incentive.currency,
            status: 'PAID',
          },
        );
      }

      return updatedPayout;
    }

    const failedPayout = await this.prisma.staffPayout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.FAILED,
        providerError: result.errorMessage,
      },
    });
    await this.auditService.record({
      action: 'staff_payout.failed',
      entityType: 'StaffPayout',
      entityId: payout.id,
      metadata: { errorMessage: result.errorMessage },
    });
    await this.notifyFinanceOfFailure(
      failedPayout.id,
      incentive.amount,
      incentive.currency,
      result.errorMessage,
    );

    return failedPayout;
  }

  /** Retry is just attemptPayout again — the upsert above reuses the same row. */
  retryPayout(incentiveId: string, requestedByStaffId: string) {
    return this.attemptPayout(incentiveId, requestedByStaffId);
  }

  listAll(filters: { staffId?: string; status?: PayoutStatus }) {
    return this.prisma.staffPayout.findMany({
      where: filters,
      include: {
        staff: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        incentive: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async staffIdentity(
    staffId: string,
  ): Promise<{ id: string; email: string } | null> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      include: { identity: { select: { id: true, email: true } } },
    });
    return staff?.identity ?? null;
  }

  private async notifyFinanceOfFailure(
    payoutId: string,
    amount: number,
    currency: string,
    errorMessage: string | undefined,
  ): Promise<void> {
    const reviewers = await this.prisma.identity.findMany({
      where: {
        roles: {
          some: {
            role: {
              permissions: {
                some: { permission: { key: PERMISSIONS.VISA.PAYOUT_APPROVE } },
              },
            },
          },
        },
      },
      select: { id: true, email: true },
    });
    const subject = `Payout failed: ${currency} ${amount}`;
    const body = [
      `A staff incentive payout of ${currency} ${amount} failed and needs review.`,
      errorMessage ? `Provider error: ${errorMessage}` : '',
      '',
      'Review it from the Visa Incentives & Payouts screen in the admin dashboard.',
    ].join('\n');
    await Promise.all(
      reviewers.map((r) =>
        this.notificationsService.sendGeneric(r.email, r.id, subject, body),
      ),
    );
  }
}
