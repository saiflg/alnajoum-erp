import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalRequestStatus,
  FlightBookingStatus,
  FlightRefundStatus,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../governance/approvals.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from '../payments/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type { FlightProviderPort } from './providers/flight-provider.port';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

export interface RefundPreview {
  ticketPrice: number;
  estimatedProviderPenalty: number;
  agencyFee: number;
  estimatedRefundAmount: number;
  currency: string;
  refundable: boolean | null;
  fareRules: unknown;
}

const FLIGHT_REFUND_APPROVAL_TYPE = 'FLIGHT_REFUND';
const FLIGHT_REFUND_ENTITY_TYPE = 'FlightRefund';

/**
 * Cancellation/refund workflow (spec #14/#15). Never assumes the whole
 * ticket price comes back:
 *
 *   refundAmount = ticketPrice − providerPenalty − agencyFee (+ refundableTaxes)
 *
 * previewRefund is read-only — it estimates the penalty from the fare
 * conditions snapshotted at booking time so the customer/staff can see the
 * number before confirming, without yet touching the provider or the
 * booking.
 *
 * Phase 11 spec #10/#11 fix — requestRefund used to call the provider and
 * move money immediately. It's now the first half of a two-step flow: it
 * records the FlightRefund at an ESTIMATED amount and opens a generic
 * ApprovalRequest (spec #10's worked example — the FLIGHT_REFUND
 * threshold rules seeded in prisma/seed-demo.ts existed all of Phase 11
 * with no call site ever resolving them). The actual provider call and
 * money movement now happen in executeApprovedRefund, run by
 * runApprovedRefundSweep once a different identity approves the request —
 * self-approval prevention is ApprovalsService's own job, not
 * re-implemented here. A rejected request reverts the booking instead.
 */
@Injectable()
export class FlightRefundsService {
  private readonly logger = new Logger(FlightRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly providerLog: ProviderTransactionLogService,
    private readonly financePostingService: FinancePostingService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private async agencyFeePercent(): Promise<number> {
    const activeProvider =
      (await this.integrationsService.getActiveProvider('FLIGHT')) ??
      this.configService.get<string>('FLIGHT_PROVIDER', 'mock');
    const config = await this.integrationsService.getCredentialConfig(
      'FLIGHT',
      activeProvider,
    );
    return Number(config?.agencyFeePercent) || 0;
  }

  /**
   * `FlightBooking.refundable` is a lossy true/false/null snapshot of the
   * fare's real 4-state refundability (REFUNDABLE/PARTIALLY_REFUNDABLE/
   * NON_REFUNDABLE/UNKNOWN, see FlightsService.createBooking) — anything
   * short of fully REFUNDABLE collapses to `false`. Using that boolean
   * directly here previously treated a PARTIALLY_REFUNDABLE fare exactly
   * like a NON_REFUNDABLE one (100% penalty, 0 refund shown), when the
   * real provider — see MockFlightProviderService.requestRefund — applies
   * only a 25% penalty for "partially refundable". The preview must match
   * what executeApprovedRefund will actually do, so read the richer
   * fareRules snapshot first and only fall back to the lossy boolean when
   * it's missing (very old records, or a manual booking with no live offer).
   */
  private resolvePenaltyRate(
    refundable: boolean | null,
    fareRules: unknown,
  ): number {
    const detailed = (fareRules as { refundable?: string } | null | undefined)
      ?.refundable;
    if (detailed === 'REFUNDABLE') return 0;
    if (detailed === 'NON_REFUNDABLE') return 1;
    if (detailed === 'PARTIALLY_REFUNDABLE' || detailed === 'UNKNOWN') {
      return 0.25;
    }
    return refundable === true ? 0 : refundable === false ? 1 : 0.25;
  }

  private async estimateRefund(booking: {
    totalAmount: number;
    refundable: boolean | null;
    fareRules: unknown;
  }) {
    const feePercent = await this.agencyFeePercent();
    const agencyFee = Math.round(booking.totalAmount * (feePercent / 100));
    const penaltyRate = this.resolvePenaltyRate(
      booking.refundable,
      booking.fareRules,
    );
    const estimatedProviderPenalty = Math.round(
      booking.totalAmount * penaltyRate,
    );
    const estimatedRefundAmount = Math.max(
      0,
      booking.totalAmount - estimatedProviderPenalty - agencyFee,
    );
    return { agencyFee, estimatedProviderPenalty, estimatedRefundAmount };
  }

  async previewRefund(
    bookingId: string,
    ownerCustomerId?: string,
  ): Promise<RefundPreview> {
    const booking = await this.getBooking(bookingId, ownerCustomerId);
    const { agencyFee, estimatedProviderPenalty, estimatedRefundAmount } =
      await this.estimateRefund(booking);

    return {
      ticketPrice: booking.totalAmount,
      estimatedProviderPenalty,
      agencyFee,
      estimatedRefundAmount,
      currency: booking.currency,
      refundable: booking.refundable,
      fareRules: booking.fareRules,
    };
  }

  private async getBooking(bookingId: string, ownerCustomerId?: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (ownerCustomerId && booking.customerId !== ownerCustomerId) {
      throw new BadRequestException(
        'This booking does not belong to this customer',
      );
    }
    return booking;
  }

  /**
   * Opens the refund request and its ApprovalRequest — never touches the
   * provider or moves any money. Returns immediately with both records so
   * the caller can show "pending approval", not a result.
   */
  async requestRefund(
    bookingId: string,
    opts: {
      requestedByStaffId?: string;
      requestedByCustomer?: boolean;
      requestedByIdentityId: string;
      reason?: string;
    },
  ) {
    const booking = await this.getBooking(bookingId);
    if (
      booking.status === FlightBookingStatus.REFUNDED ||
      booking.status === FlightBookingStatus.CANCELLED
    ) {
      throw new ConflictException(
        'This booking has already been cancelled/refunded',
      );
    }

    const { agencyFee, estimatedProviderPenalty, estimatedRefundAmount } =
      await this.estimateRefund(booking);

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      select: { companyId: true },
    });

    // The status executeApprovedRefund/rejectRefund revert to on
    // failure/rejection — captured now since by the time either runs
    // (from the sweep, possibly much later) the booking already sits at
    // REFUND_REQUESTED and the original status is otherwise lost.
    const originalBookingStatus = booking.status;

    await this.prisma.flightBooking.update({
      where: { id: bookingId },
      data: { status: FlightBookingStatus.REFUND_REQUESTED },
    });

    const refund = await this.prisma.flightRefund.create({
      data: {
        bookingId,
        requestedByStaffId: opts.requestedByStaffId,
        requestedByCustomer: opts.requestedByCustomer ?? false,
        ticketPrice: booking.totalAmount,
        providerPenalty: estimatedProviderPenalty,
        agencyFee,
        refundAmount: estimatedRefundAmount,
        currency: booking.currency,
        status: FlightRefundStatus.REQUESTED,
        reason: opts.reason,
        providerResponse: {
          originalBookingStatus,
          note: 'Estimated amount — awaiting approval before the provider is contacted.',
        },
      },
    });

    const approvalRequest = await this.approvalsService.createRequest({
      type: FLIGHT_REFUND_APPROVAL_TYPE,
      amount: estimatedRefundAmount,
      currency: booking.currency,
      entityType: FLIGHT_REFUND_ENTITY_TYPE,
      entityId: refund.id,
      requestedByIdentityId: opts.requestedByIdentityId,
      companyId: customer?.companyId,
      reason: opts.reason,
    });

    await this.auditService.record({
      identityId: opts.requestedByIdentityId,
      action: 'flight_refund.requested',
      entityType: 'FlightRefund',
      entityId: refund.id,
      metadata: {
        bookingId,
        estimatedRefundAmount,
        approvalRequestId: approvalRequest.id,
        requiredApprovals: approvalRequest.requiredApprovals,
      },
    });

    return { refund, approvalRequest };
  }

  /**
   * Runs once ApprovalsService.decide() has resolved the request — never
   * called directly from a controller. Idempotent: a refund not sitting
   * at REQUESTED has already been executed (or was never approved), so a
   * repeat sweep pass is a silent no-op rather than double-refunding.
   */
  private async executeApprovedRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.flightRefund.findUnique({
      where: { id: refundId },
      include: { booking: true },
    });
    if (!refund || refund.status !== FlightRefundStatus.REQUESTED) return;

    const { booking } = refund;
    const originalBookingStatus =
      (refund.providerResponse as { originalBookingStatus?: string } | null)
        ?.originalBookingStatus ?? FlightBookingStatus.TICKETED;

    const capabilities = await this.provider.capabilities();

    // Spec #40 — a manual/offline booking has no live provider order to
    // call, exactly like a provider that lacks refund support: it's
    // recorded as needing a human to process it outside the system,
    // never a hard failure.
    if (!capabilities.refund || !booking.providerOrderId) {
      await this.prisma.flightRefund.update({
        where: { id: refundId },
        data: {
          status: FlightRefundStatus.PROCESSING,
          providerResponse: {
            note: 'This provider does not support automated refunds — process manually and update this record.',
          },
        },
      });
      await this.auditService.record({
        action: 'flight_refund.manual_required',
        entityType: 'FlightRefund',
        entityId: refundId,
        metadata: { bookingId: booking.id, provider: booking.provider },
      });
      return;
    }

    const result = await this.provider.requestRefund(
      booking.providerOrderId,
      booking.totalAmount,
      booking.currency,
    );

    await this.providerLog.record({
      provider: booking.provider,
      operation: ProviderOperation.REFUND,
      bookingId: booking.id,
      status:
        result.status === 'REFUNDED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'REFUNDED'
          ? `Refunded, provider penalty ${result.providerPenalty}`
          : (result.errorMessage ?? 'Refund failed'),
    });

    if (result.status === 'FAILED') {
      await this.prisma.flightBooking.update({
        where: { id: booking.id },
        data: { status: originalBookingStatus as FlightBookingStatus },
      });
      await this.prisma.flightRefund.update({
        where: { id: refundId },
        data: {
          status: FlightRefundStatus.FAILED,
          refundAmount: 0,
          providerResponse: { errorMessage: result.errorMessage },
        },
      });
      await this.auditService.record({
        action: 'flight_refund.failed',
        entityType: 'FlightRefund',
        entityId: refundId,
        metadata: { bookingId: booking.id, errorMessage: result.errorMessage },
      });
      return;
    }

    const refundAmount = Math.max(
      0,
      booking.totalAmount - result.providerPenalty - refund.agencyFee,
    );

    const [updatedRefund] = await this.prisma.$transaction([
      this.prisma.flightRefund.update({
        where: { id: refundId },
        data: {
          status: FlightRefundStatus.COMPLETED,
          providerPenalty: result.providerPenalty,
          refundAmount,
          providerResponse: { providerRefundId: result.providerRefundId },
          completedAt: new Date(),
        },
      }),
      this.prisma.flightBooking.update({
        where: { id: booking.id },
        data: { status: FlightBookingStatus.REFUNDED },
      }),
    ]);

    await this.invoicesService.voidIfUnpaid(booking.id);

    if (refundAmount > 0) {
      await this.financePostingService.postRefund({
        amount: refundAmount,
        currency: booking.currency,
        reference: `FREFUND-${refundId}`,
        description: `Flight refund for booking ${booking.bookingReference}`,
        sourceModule: 'FLIGHT_REFUND',
        sourceId: refundId,
      });
    }
    // The booking earned no valid sale once refunded — any staff incentive
    // already generated (or approved-but-not-yet-paid) on it must not
    // remain payable (spec #29).
    await this.financePostingService.cancelIncentivesForSource(
      'FLIGHT_BOOKING',
      booking.id,
      `Booking ${booking.bookingReference} was refunded`,
    );

    await this.auditService.record({
      action: 'flight_refund.completed',
      entityType: 'FlightRefund',
      entityId: refundId,
      metadata: {
        bookingId: booking.id,
        refundAmount,
        providerPenalty: result.providerPenalty,
        agencyFee: refund.agencyFee,
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Refund completed — ${booking.bookingReference}`,
        `Your refund of ${booking.currency} ${refundAmount} for booking ${booking.bookingReference} has been completed.`,
      );
    }
    void updatedRefund;
  }

  /** The rejection counterpart — reverts the booking to whatever it was
   * before the refund was requested rather than leaving it stuck at
   * REFUND_REQUESTED forever. */
  private async rejectRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.flightRefund.findUnique({
      where: { id: refundId },
    });
    if (!refund || refund.status !== FlightRefundStatus.REQUESTED) return;

    const originalBookingStatus =
      (refund.providerResponse as { originalBookingStatus?: string } | null)
        ?.originalBookingStatus ?? FlightBookingStatus.TICKETED;

    await this.prisma.$transaction([
      this.prisma.flightRefund.update({
        where: { id: refundId },
        data: { status: FlightRefundStatus.REJECTED },
      }),
      this.prisma.flightBooking.update({
        where: { id: refund.bookingId },
        data: { status: originalBookingStatus as FlightBookingStatus },
      }),
    ]);

    await this.auditService.record({
      action: 'flight_refund.rejected',
      entityType: 'FlightRefund',
      entityId: refundId,
      metadata: { bookingId: refund.bookingId },
    });
  }

  /**
   * The approval engine's own decide() knows nothing about flights (it's
   * deliberately generic — see its own doc comment); this is what closes
   * the loop, polling for FLIGHT_REFUND requests a decision has resolved
   * and executing (or reverting) the refund they gate. Every candidate is
   * independently try/caught so one bad row never blocks the rest.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runApprovedRefundSweep(): Promise<{
    considered: number;
    executed: number;
    rejected: number;
    failed: number;
  }> {
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        type: FLIGHT_REFUND_APPROVAL_TYPE,
        entityType: FLIGHT_REFUND_ENTITY_TYPE,
        status: {
          in: [ApprovalRequestStatus.APPROVED, ApprovalRequestStatus.REJECTED],
        },
      },
      select: { status: true, entityId: true },
    });

    const refundIds = requests
      .map((r) => r.entityId)
      .filter((id): id is string => !!id);
    const pendingRefunds =
      refundIds.length === 0
        ? []
        : await this.prisma.flightRefund.findMany({
            where: {
              id: { in: refundIds },
              status: FlightRefundStatus.REQUESTED,
            },
            select: { id: true },
          });
    const pendingIds = new Set(pendingRefunds.map((r) => r.id));

    let executed = 0;
    let rejected = 0;
    let failed = 0;

    for (const request of requests) {
      if (!request.entityId || !pendingIds.has(request.entityId)) continue;
      try {
        if (request.status === ApprovalRequestStatus.APPROVED) {
          await this.executeApprovedRefund(request.entityId);
          executed += 1;
        } else {
          await this.rejectRefund(request.entityId);
          rejected += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Refund approval sweep skipped ${request.entityId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const summary = { considered: pendingIds.size, executed, rejected, failed };
    this.logger.log(
      `Approved-refund sweep complete: ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  listAll(filters: { bookingId?: string; status?: FlightRefundStatus }) {
    return this.prisma.flightRefund.findMany({
      where: filters,
      include: {
        booking: { select: { bookingReference: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
