import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  InvoiceStatus,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightIncentivesService } from './flight-incentives.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type {
  FlightOffer,
  FlightProviderPort,
} from './providers/flight-provider.port';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

/**
 * Turns a paid-for, CONFIRMED FlightBooking into an issued ticket (spec
 * #10). Never called automatically from booking or payment confirmation —
 * always an explicit authorized-staff action (or, for a provider whose
 * order is already provider-side instant-ticketed like Duffel, this is
 * still the step that fetches and records the PNR/ticket numbers on our
 * side and is what actually flips FlightBooking.status to TICKETED). The
 * spec is explicit: "Do not mark a booking as ticketed until ticket
 * issuance is actually confirmed" — a failed attempt here leaves the
 * booking CONFIRMED, unticketed, ready to retry.
 */
@Injectable()
export class FlightTicketingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly notificationsService: NotificationsService,
    private readonly flightIncentivesService: FlightIncentivesService,
    private readonly providerLog: ProviderTransactionLogService,
  ) {}

  async issueTicket(bookingId: string, staffId: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
      include: { passengers: true, invoice: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === FlightBookingStatus.TICKETED) {
      throw new ConflictException('This booking has already been ticketed');
    }
    if (booking.status !== FlightBookingStatus.CONFIRMED) {
      throw new ConflictException(
        `This booking is ${booking.status.toLowerCase()}, not confirmed — it must be confirmed (and paid) before it can be ticketed`,
      );
    }
    if (!booking.invoice || booking.invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Payment has not been confirmed for this booking yet — ticket issuance requires a paid invoice.',
      );
    }
    if (!booking.providerOrderId) {
      throw new BadRequestException(
        'This booking has no provider order to ticket.',
      );
    }

    const offer = booking.itinerary as unknown as FlightOffer;
    const result = await this.provider.issueTicket(
      booking.providerOrderId,
      offer,
    );

    await this.providerLog.record({
      provider: booking.provider,
      operation: ProviderOperation.ISSUE_TICKET,
      bookingId: booking.id,
      status:
        result.status === 'TICKETED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'TICKETED'
          ? `Ticketed, PNR ${result.pnr}`
          : (result.errorMessage ?? 'Ticket issuance failed'),
    });

    if (result.status === 'FAILED') {
      throw new ConflictException(
        'The flight provider could not issue this ticket right now. Please try again shortly.',
      );
    }

    const perPassengerTicketNumbers =
      result.ticketNumbers ??
      booking.passengers.map(
        (_, i) => `${result.pnr}-${String(i + 1).padStart(2, '0')}`,
      );

    const [updatedBooking] = await this.prisma.$transaction([
      this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: {
          status: FlightBookingStatus.TICKETED,
          pnr: result.pnr,
          ticketedAt: new Date(),
          ticketedByStaffId: staffId,
        },
      }),
      ...booking.passengers.map((passenger, i) =>
        this.prisma.flightBookingPassenger.update({
          where: { id: passenger.id },
          data: { ticketNumber: perPassengerTicketNumbers[i] ?? null },
        }),
      ),
    ]);

    await this.flightIncentivesService.createForTicketedBooking(updatedBooking);

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Your ticket is issued — ${booking.bookingReference}`,
        `Your flight ${booking.origin} → ${booking.destination} is now ticketed. PNR: ${result.pnr}. You can download your e-ticket from your portal.`,
      );
    }

    return updatedBooking;
  }
}
