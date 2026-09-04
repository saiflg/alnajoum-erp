import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  FlightReissueStatus,
  Prisma,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type {
  BookingPassengerSnapshot,
  FlightOffer,
  FlightProviderPort,
} from './providers/flight-provider.port';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

/**
 * Flight change/reissue workflow (spec #16):
 *   Original Booking -> Request Change -> Retrieve Alternatives (regular
 *   search) -> Calculate Fare Difference -> Calculate Change Penalty ->
 *   Customer Approval -> Payment if required -> Reissue -> Update Ticket ->
 *   Generate New Itinerary
 *
 * Every request gets its own FlightReissue row (never mutates history away)
 * — see the schema doc comment. When the active provider doesn't support
 * automated reissue (spec #10's "show as unavailable... controlled manual
 * workflow"), completeReissue requires an explicit manually-obtained PNR
 * rather than silently pretending the change went through.
 */
@Injectable()
export class FlightReissueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly providerLog: ProviderTransactionLogService,
  ) {}

  private async changePenaltyPercent(): Promise<number> {
    const activeProvider =
      (await this.integrationsService.getActiveProvider('FLIGHT')) ??
      this.configService.get<string>('FLIGHT_PROVIDER', 'mock');
    const config = await this.integrationsService.getCredentialConfig(
      'FLIGHT',
      activeProvider,
    );
    return Number(config?.changePenaltyPercent) || 0;
  }

  async requestReissue(
    bookingId: string,
    newOfferId: string,
    requestedByStaffId: string | undefined,
  ) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status !== FlightBookingStatus.TICKETED) {
      throw new ConflictException('Only a ticketed booking can be reissued');
    }

    const newOffer = await this.provider.getOffer(newOfferId);
    if (!newOffer) {
      throw new BadRequestException(
        'The selected alternative offer has expired — please search again.',
      );
    }

    const fareDifference = newOffer.totalAmount - booking.totalAmount;
    const changePenalty = Math.round(
      booking.totalAmount * ((await this.changePenaltyPercent()) / 100),
    );
    const totalDue = Math.max(0, fareDifference) + changePenalty;

    const [reissue] = await this.prisma.$transaction([
      this.prisma.flightReissue.create({
        data: {
          bookingId,
          requestedByStaffId,
          originalOfferSnapshot: booking.itinerary as Prisma.InputJsonValue,
          newOfferSnapshot: newOffer as unknown as Prisma.InputJsonValue,
          fareDifference,
          changePenalty,
          totalDue,
          currency: booking.currency,
          status:
            totalDue > 0
              ? FlightReissueStatus.AWAITING_PAYMENT
              : FlightReissueStatus.REQUESTED,
        },
      }),
      this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: { status: FlightBookingStatus.REISSUE_REQUESTED },
      }),
    ]);

    return reissue;
  }

  /**
   * Confirms the reissue — called once any fare-difference/penalty payment
   * has been collected (AWAITING_PAYMENT -> here acts as the payment
   * confirmation, matching how the rest of this codebase gates a status
   * change on staff action rather than a webhook for this internal step).
   * `manualPnr` is required exactly when the active provider doesn't
   * support automated reissue.
   */
  async completeReissue(
    reissueId: string,
    staffId: string,
    manualPnr?: string,
  ) {
    const reissue = await this.prisma.flightReissue.findUnique({
      where: { id: reissueId },
      include: { booking: true },
    });
    if (!reissue) {
      throw new NotFoundException('Reissue request not found');
    }
    if (reissue.status === FlightReissueStatus.COMPLETED) {
      throw new ConflictException('This reissue has already been completed');
    }
    if (
      reissue.status === FlightReissueStatus.FAILED ||
      reissue.status === FlightReissueStatus.REJECTED
    ) {
      throw new ConflictException(
        `This reissue is ${reissue.status.toLowerCase()} and cannot be completed`,
      );
    }

    const capabilities = await this.provider.capabilities();
    const newOffer = reissue.newOfferSnapshot as unknown as FlightOffer;
    const booking = reissue.booking;

    if (!capabilities.reissue) {
      if (!manualPnr) {
        throw new BadRequestException(
          'This provider does not support automated reissue — pass manualPnr once the change has been confirmed with the airline directly.',
        );
      }
      return this.finalize(
        reissue.id,
        booking.id,
        newOffer,
        {
          providerOrderId: booking.providerOrderId ?? '',
          pnr: manualPnr,
        },
        staffId,
        { manual: true },
      );
    }

    const passengers: BookingPassengerSnapshot[] = (
      await this.prisma.flightBookingPassenger.findMany({
        where: { bookingId: booking.id },
      })
    ).map((p) => ({
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      passportNumber: p.passportNumber,
    }));

    const result = await this.provider.reissue(
      booking.providerOrderId ?? '',
      newOffer,
      passengers,
    );

    await this.providerLog.record({
      provider: booking.provider,
      operation: ProviderOperation.REISSUE,
      bookingId: booking.id,
      status:
        result.status === 'REISSUED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'REISSUED'
          ? `Reissued, new PNR ${result.pnr}`
          : (result.errorMessage ?? 'Reissue failed'),
    });

    if (result.status === 'FAILED') {
      await this.prisma.$transaction([
        this.prisma.flightReissue.update({
          where: { id: reissueId },
          data: { status: FlightReissueStatus.FAILED },
        }),
        this.prisma.flightBooking.update({
          where: { id: booking.id },
          data: { status: FlightBookingStatus.TICKETED },
        }),
      ]);
      throw new ConflictException(
        `The flight provider could not process this reissue: ${result.errorMessage ?? 'unknown error'}`,
      );
    }

    return this.finalize(reissue.id, booking.id, newOffer, result, staffId, {});
  }

  private async finalize(
    reissueId: string,
    bookingId: string,
    newOffer: FlightOffer,
    result: { providerOrderId: string; pnr: string },
    staffId: string,
    opts: { manual?: boolean },
  ) {
    const [, updatedBooking] = await this.prisma.$transaction([
      this.prisma.flightReissue.update({
        where: { id: reissueId },
        data: {
          status: FlightReissueStatus.COMPLETED,
          completedAt: new Date(),
          providerResponse: opts.manual
            ? { manual: true, enteredByStaffId: staffId }
            : { providerOrderId: result.providerOrderId },
        },
      }),
      this.prisma.flightBooking.update({
        where: { id: bookingId },
        data: {
          status: FlightBookingStatus.TICKETED,
          itinerary: newOffer as unknown as Prisma.InputJsonValue,
          totalAmount: newOffer.totalAmount,
          providerOrderId: result.providerOrderId || undefined,
          pnr: result.pnr,
          ticketedAt: new Date(),
          ticketedByStaffId: staffId,
        },
      }),
    ]);

    await this.auditService.record({
      action: 'flight_reissue.completed',
      entityType: 'FlightReissue',
      entityId: reissueId,
      metadata: { bookingId, manual: opts.manual ?? false, newPnr: result.pnr },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: updatedBooking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Your itinerary changed — ${updatedBooking.bookingReference}`,
        `Your flight ${updatedBooking.origin} → ${updatedBooking.destination} has been reissued. New PNR: ${result.pnr}.`,
      );
    }

    return updatedBooking;
  }

  listAll(filters: { bookingId?: string; status?: FlightReissueStatus }) {
    return this.prisma.flightReissue.findMany({
      where: filters,
      include: {
        booking: { select: { bookingReference: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
