import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  FlightVoidStatus,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type { FlightProviderPort } from './providers/flight-provider.port';

/** Spec #18 — a real GDS void window is same-day; 24 hours from ticketing
 * is a realistic, if not provider-verified, default (never a configurable
 * business promise since no provider here actually returns its own void
 * deadline — see FlightVoid's schema comment). */
const VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Phase 10 spec #18 — void undoes a ticket within the airline's same-day
 * window as if it never existed: full reversal, no penalty. Distinct from
 * FlightRefundsService (which applies a penalty for an already-accepted
 * cancellation) — see FlightVoid's own schema doc comment. Only authorized
 * staff reach this at all (gated by PERMISSIONS.FLIGHT.VOID at the
 * controller, per spec #18's "never allow unauthorized users to void
 * tickets").
 */
@Injectable()
export class FlightVoidsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly providerLog: ProviderTransactionLogService,
    private readonly financePostingService: FinancePostingService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  private async getBooking(bookingId: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
      include: { passengers: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Read-only — lets the UI show the deadline/eligibility before staff commits. */
  async getEligibility(bookingId: string) {
    const booking = await this.getBooking(bookingId);
    if (
      booking.status !== FlightBookingStatus.TICKETED ||
      !booking.ticketedAt
    ) {
      return {
        eligible: false,
        voidDeadline: null,
        reason: 'Only a ticketed booking can be voided.',
      };
    }
    const voidDeadline = new Date(
      booking.ticketedAt.getTime() + VOID_WINDOW_MS,
    );
    const eligible = new Date() <= voidDeadline;
    return {
      eligible,
      voidDeadline: voidDeadline.toISOString(),
      reason: eligible
        ? null
        : 'The void window for this ticket has passed — use refund/cancellation instead.',
    };
  }

  async requestVoid(bookingId: string, requestedByStaffId: string) {
    const booking = await this.getBooking(bookingId);
    if (
      booking.status !== FlightBookingStatus.TICKETED ||
      !booking.ticketedAt
    ) {
      throw new ConflictException('Only a ticketed booking can be voided.');
    }
    const voidDeadline = new Date(
      booking.ticketedAt.getTime() + VOID_WINDOW_MS,
    );
    if (new Date() > voidDeadline) {
      throw new ConflictException(
        'The void window for this ticket has passed — use refund/cancellation instead.',
      );
    }

    const ticketNumbers = booking.passengers
      .map((p) => p.ticketNumber)
      .filter((t): t is string => !!t);
    const capabilities = await this.provider.capabilities();

    await this.prisma.flightBooking.update({
      where: { id: bookingId },
      data: { status: FlightBookingStatus.VOID_REQUESTED },
    });

    // Spec #40 — a manual/offline booking has no live provider order to
    // call, exactly like a provider that lacks void support: it goes
    // through the same manual-required path below, never a hard failure.
    if (!capabilities.void || !booking.providerOrderId) {
      const manual = await this.prisma.flightVoid.create({
        data: {
          bookingId,
          requestedByStaffId,
          ticketNumbers,
          voidDeadline,
          amountVoided: 0,
          currency: booking.currency,
          status: FlightVoidStatus.REQUESTED,
          providerResponse: {
            note: 'This provider does not support automated void — process manually with the airline/GDS and update this record.',
          },
        },
      });
      await this.auditService.record({
        action: 'flight_void.manual_required',
        entityType: 'FlightVoid',
        entityId: manual.id,
        metadata: { bookingId, provider: booking.provider },
      });
      return manual;
    }

    const result = await this.provider.requestVoid(
      booking.providerOrderId,
      ticketNumbers,
    );

    await this.providerLog.record({
      provider: booking.provider,
      operation: ProviderOperation.CANCEL_ORDER,
      bookingId,
      status:
        result.status === 'VOIDED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'VOIDED'
          ? 'Voided'
          : (result.errorMessage ?? 'Void failed'),
    });

    if (result.status === 'FAILED') {
      await this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: { status: booking.status }, // revert — void never happened
      });
      const failed = await this.prisma.flightVoid.create({
        data: {
          bookingId,
          requestedByStaffId,
          ticketNumbers,
          voidDeadline,
          amountVoided: 0,
          currency: booking.currency,
          status: FlightVoidStatus.FAILED,
          providerResponse: { errorMessage: result.errorMessage },
        },
      });
      await this.auditService.record({
        action: 'flight_void.failed',
        entityType: 'FlightVoid',
        entityId: failed.id,
        metadata: { bookingId, errorMessage: result.errorMessage },
      });
      throw new ConflictException(
        `The flight provider could not void this ticket: ${result.errorMessage ?? 'unknown error'}`,
      );
    }

    const [voidRecord] = await this.prisma.$transaction([
      this.prisma.flightVoid.create({
        data: {
          bookingId,
          requestedByStaffId,
          ticketNumbers,
          voidDeadline,
          amountVoided: booking.totalAmount,
          currency: booking.currency,
          status: FlightVoidStatus.VOIDED,
          completedAt: new Date(),
        },
      }),
      this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: { status: FlightBookingStatus.VOIDED },
      }),
    ]);

    // A void is a full, no-penalty reversal — the whole amount comes back,
    // unlike FlightRefundsService's penalty-adjusted refund.
    await this.financePostingService.postRefund({
      amount: booking.totalAmount,
      currency: booking.currency,
      reference: `FVOID-${voidRecord.id}`,
      description: `Flight void for booking ${booking.bookingReference}`,
      sourceModule: 'FLIGHT_VOID',
      sourceId: voidRecord.id,
    });
    await this.financePostingService.cancelIncentivesForSource(
      'FLIGHT_BOOKING',
      bookingId,
      `Booking ${booking.bookingReference} was voided`,
    );

    await this.auditService.record({
      action: 'flight_void.completed',
      entityType: 'FlightVoid',
      entityId: voidRecord.id,
      metadata: { bookingId, amountVoided: booking.totalAmount },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Ticket voided — ${booking.bookingReference}`,
        `Your ticket for booking ${booking.bookingReference} has been voided and the full amount of ${booking.currency} ${booking.totalAmount} has been reversed.`,
      );
    }

    return voidRecord;
  }

  listAll(filters: { bookingId?: string; status?: FlightVoidStatus }) {
    return this.prisma.flightVoid.findMany({
      where: filters,
      include: {
        booking: { select: { bookingReference: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
