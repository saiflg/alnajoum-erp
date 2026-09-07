import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  FlightRefundStatus,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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

/**
 * Cancellation/refund workflow (spec #14/#15). Never assumes the whole
 * ticket price comes back:
 *
 *   refundAmount = ticketPrice − providerPenalty − agencyFee (+ refundableTaxes)
 *
 * previewRefund is read-only — it estimates the penalty from the fare
 * conditions snapshotted at booking time so the customer/staff can see the
 * number before confirming, without yet touching the provider or the
 * booking. requestRefund is the real action: calls the provider (when it
 * supports refunds), records the actual penalty it returns, and only then
 * updates the booking and financial records.
 */
@Injectable()
export class FlightRefundsService {
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
   * what requestRefund will actually do, so read the richer fareRules
   * snapshot first and only fall back to the lossy boolean when it's
   * missing (very old records, or a manual booking with no live offer).
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

  async previewRefund(
    bookingId: string,
    ownerCustomerId?: string,
  ): Promise<RefundPreview> {
    const booking = await this.getBooking(bookingId, ownerCustomerId);
    const feePercent = await this.agencyFeePercent();
    const agencyFee = Math.round(booking.totalAmount * (feePercent / 100));

    const refundable = booking.refundable;
    const penaltyRate = this.resolvePenaltyRate(refundable, booking.fareRules);
    const estimatedProviderPenalty = Math.round(
      booking.totalAmount * penaltyRate,
    );
    const estimatedRefundAmount = Math.max(
      0,
      booking.totalAmount - estimatedProviderPenalty - agencyFee,
    );

    return {
      ticketPrice: booking.totalAmount,
      estimatedProviderPenalty,
      agencyFee,
      estimatedRefundAmount,
      currency: booking.currency,
      refundable,
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

  async requestRefund(
    bookingId: string,
    opts: {
      requestedByStaffId?: string;
      requestedByCustomer?: boolean;
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

    const capabilities = await this.provider.capabilities();
    const feePercent = await this.agencyFeePercent();
    const agencyFee = Math.round(booking.totalAmount * (feePercent / 100));

    await this.prisma.flightBooking.update({
      where: { id: bookingId },
      data: { status: FlightBookingStatus.REFUND_REQUESTED },
    });

    // Spec #40 — a manual/offline booking has no live provider order to
    // call, exactly like a provider that lacks refund support: it goes
    // through the same manual-required path below, never a hard failure.
    if (!capabilities.refund || !booking.providerOrderId) {
      const refund = await this.prisma.flightRefund.create({
        data: {
          bookingId,
          requestedByStaffId: opts.requestedByStaffId,
          requestedByCustomer: opts.requestedByCustomer ?? false,
          ticketPrice: booking.totalAmount,
          agencyFee,
          refundAmount: 0,
          currency: booking.currency,
          status: FlightRefundStatus.REQUESTED,
          reason: opts.reason,
          providerResponse: {
            note: 'This provider does not support automated refunds — process manually and update this record.',
          },
        },
      });
      await this.auditService.record({
        identityId: undefined,
        action: 'flight_refund.manual_required',
        entityType: 'FlightRefund',
        entityId: refund.id,
        metadata: { bookingId, provider: booking.provider },
      });
      return refund;
    }

    const result = await this.provider.requestRefund(
      booking.providerOrderId,
      booking.totalAmount,
      booking.currency,
    );

    await this.providerLog.record({
      provider: booking.provider,
      operation: ProviderOperation.REFUND,
      bookingId,
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
        where: { id: bookingId },
        data: { status: booking.status }, // revert — refund never happened
      });
      const failed = await this.prisma.flightRefund.create({
        data: {
          bookingId,
          requestedByStaffId: opts.requestedByStaffId,
          requestedByCustomer: opts.requestedByCustomer ?? false,
          ticketPrice: booking.totalAmount,
          agencyFee,
          refundAmount: 0,
          currency: booking.currency,
          status: FlightRefundStatus.FAILED,
          reason: opts.reason,
          providerResponse: { errorMessage: result.errorMessage },
        },
      });
      await this.auditService.record({
        action: 'flight_refund.failed',
        entityType: 'FlightRefund',
        entityId: failed.id,
        metadata: { bookingId, errorMessage: result.errorMessage },
      });
      throw new ConflictException(
        `The flight provider could not process this refund: ${result.errorMessage ?? 'unknown error'}`,
      );
    }

    const refundAmount = Math.max(
      0,
      booking.totalAmount - result.providerPenalty - agencyFee,
    );

    const [refund] = await this.prisma.$transaction([
      this.prisma.flightRefund.create({
        data: {
          bookingId,
          requestedByStaffId: opts.requestedByStaffId,
          requestedByCustomer: opts.requestedByCustomer ?? false,
          ticketPrice: booking.totalAmount,
          providerPenalty: result.providerPenalty,
          agencyFee,
          refundAmount,
          currency: booking.currency,
          status: FlightRefundStatus.COMPLETED,
          reason: opts.reason,
          providerResponse: { providerRefundId: result.providerRefundId },
          completedAt: new Date(),
        },
      }),
      this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: { status: FlightBookingStatus.REFUNDED },
      }),
    ]);

    await this.invoicesService.voidIfUnpaid(bookingId);

    if (refundAmount > 0) {
      await this.financePostingService.postRefund({
        amount: refundAmount,
        currency: booking.currency,
        reference: `FREFUND-${refund.id}`,
        description: `Flight refund for booking ${booking.bookingReference}`,
        sourceModule: 'FLIGHT_REFUND',
        sourceId: refund.id,
      });
    }
    // The booking earned no valid sale once refunded — any staff incentive
    // already generated (or approved-but-not-yet-paid) on it must not
    // remain payable (spec #29).
    await this.financePostingService.cancelIncentivesForSource(
      'FLIGHT_BOOKING',
      bookingId,
      `Booking ${booking.bookingReference} was refunded`,
    );

    await this.auditService.record({
      action: 'flight_refund.completed',
      entityType: 'FlightRefund',
      entityId: refund.id,
      metadata: {
        bookingId,
        refundAmount,
        providerPenalty: result.providerPenalty,
        agencyFee,
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

    return refund;
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
