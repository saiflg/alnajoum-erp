import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IncentiveStatus, PayoutStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { FeatureFlagsService } from '../governance/feature-flags.service';
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
  private readonly logger = new Logger(StaffPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly financePostingService: FinancePostingService,
    private readonly featureFlagsService: FeatureFlagsService,
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
   *
   * requestedByStaffId is null for the automatic sweep below (spec #39's
   * ENABLE_AUTOMATIC_PAYOUT) — every other call site is a real staff
   * member clicking "pay out" and passes their own id.
   */
  async attemptPayout(incentiveId: string, requestedByStaffId: string | null) {
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
    // Phase 6 spec #12: money never moves to an account Finance hasn't
    // verified — StaffBankAccountsService resets this flag whenever the
    // account details themselves change, so a swap always requires
    // re-verification before the next payout can proceed.
    if (!staff.bankAccountVerified) {
      throw new BadRequestException(
        `${staff.firstName} ${staff.lastName}'s payout bank account has not been verified by Finance — verify it before requesting a payout`,
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
      await this.financePostingService.postIncentivePaid(updatedPayout);

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

  /**
   * Spec #39's ENABLE_AUTOMATIC_PAYOUT — the flag's whole reason to exist.
   * Off (the seeded default), every incentive stays exactly as it's
   * always been: Finance manually reviews and clicks "pay out"
   * (attemptPayout above) one at a time. On, this sweep does that same
   * click for every APPROVED, not-yet-successfully-paid incentive —
   * reusing attemptPayout itself rather than a second money-moving path,
   * so bank-detail/verification checks, audit records, and notifications
   * all stay identical between the manual and automatic route. The flag
   * is evaluated per company (never globally): a tenant that hasn't
   * opted in keeps the manual-only flow even while others have automated
   * it. One incentive's failure (e.g. unverified bank account) never
   * stops the sweep from reaching the rest.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runAutomaticPayoutSweep(): Promise<{
    considered: number;
    paidOut: number;
    failed: number;
  }> {
    const candidates = await this.prisma.staffIncentive.findMany({
      where: {
        status: IncentiveStatus.APPROVED,
        OR: [{ payout: null }, { payout: { status: PayoutStatus.FAILED } }],
      },
      select: { id: true, staff: { select: { companyId: true } } },
    });

    let paidOut = 0;
    let failed = 0;
    const enabledByCompany = new Map<string, boolean>();

    for (const candidate of candidates) {
      const { companyId } = candidate.staff;
      let enabled = enabledByCompany.get(companyId);
      if (enabled === undefined) {
        enabled = await this.featureFlagsService.isEnabled(
          'ENABLE_AUTOMATIC_PAYOUT',
          companyId,
        );
        enabledByCompany.set(companyId, enabled);
      }
      if (!enabled) continue;

      try {
        const result = await this.attemptPayout(candidate.id, null);
        if (result.status === PayoutStatus.SUCCESSFUL) {
          paidOut += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Automatic payout sweep skipped incentive ${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const summary = { considered: candidates.length, paidOut, failed };
    this.logger.log(
      `Automatic payout sweep complete: ${JSON.stringify(summary)}`,
    );
    return summary;
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
