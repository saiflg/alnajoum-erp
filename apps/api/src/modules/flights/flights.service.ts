import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  Prisma,
  ProviderOperation,
  ProviderTransactionStatus,
  TripType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { CreatePassengerDto } from './dto/create-passenger.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightPricingService } from './flight-pricing.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type {
  BookingPassengerSnapshot,
  FlightOffer,
  FlightProviderPort,
} from './providers/flight-provider.port';

function generateBookingReference(): string {
  return `ANJ-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export interface RevalidationResult {
  offer: FlightOffer;
  priceChanged: boolean;
  previousAmount: number;
  currentAmount: number;
}

@Injectable()
export class FlightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly pricingService: FlightPricingService,
    private readonly providerLog: ProviderTransactionLogService,
  ) {}

  async search(dto: SearchFlightsDto): Promise<FlightOffer[]> {
    this.validateLegCount(dto.tripType, dto.legs.length);

    try {
      const offers = await this.provider.searchOffers({
        tripType: dto.tripType,
        legs: dto.legs,
        adults: dto.adults,
        children: dto.children,
        infants: dto.infants,
        cabinClass: dto.cabinClass,
        directOnly: dto.directOnly,
      });
      await this.providerLog.record({
        provider: offers[0]?.provider ?? 'MOCK',
        operation: ProviderOperation.SEARCH,
        status: ProviderTransactionStatus.SUCCESS,
        safeMessage: `${offers.length} offer(s) returned`,
      });
      // Fare conditions/restrictions are shown as-is, never invented — the
      // customer/staff sees exactly what searchOffers's fareConditions
      // carried through from the provider (spec #4/#5).
      return dto.directOnly
        ? offers.filter((o) => o.legs.every((l) => l.segments.length === 1))
        : offers;
    } catch (error) {
      await this.providerLog.record({
        provider: 'MOCK',
        operation: ProviderOperation.SEARCH,
        status: ProviderTransactionStatus.FAILURE,
        safeMessage: error instanceof Error ? error.message : 'Search failed',
      });
      throw error;
    }
  }

  /**
   * Price revalidation (spec #6) — refetches the offer from the provider
   * and reports whether the price moved since the customer last saw it.
   * Never assumes a cached search price is still valid: createBooking below
   * always calls getOffer itself too, so a stale offer can't slip through
   * even if a caller skips this step.
   */
  async revalidate(
    offerId: string,
    previousAmount: number,
  ): Promise<RevalidationResult> {
    const offer = await this.getOffer(offerId);
    return {
      offer,
      priceChanged: offer.totalAmount !== previousAmount,
      previousAmount,
      currentAmount: offer.totalAmount,
    };
  }

  private validateLegCount(tripType: TripType, legCount: number): void {
    if (tripType === TripType.ONE_WAY && legCount !== 1) {
      throw new BadRequestException('A one-way trip must have exactly 1 leg');
    }
    if (tripType === TripType.ROUND_TRIP && legCount !== 2) {
      throw new BadRequestException(
        'A round trip must have exactly 2 legs (outbound and return)',
      );
    }
    if (tripType === TripType.MULTI_CITY && legCount < 2) {
      throw new BadRequestException(
        'A multi-city trip must have at least 2 legs',
      );
    }
  }

  async getOffer(offerId: string): Promise<FlightOffer> {
    const offer = await this.provider.getOffer(offerId);
    if (!offer) {
      throw new NotFoundException(
        'This flight offer has expired or does not exist',
      );
    }
    return offer;
  }

  /**
   * Resolves each passenger input to a name/DOB/passport snapshot, verifying
   * that any referenced family member actually belongs to `customerId`.
   */
  private async resolvePassengerSnapshots(
    customerId: string,
    passengers: CreatePassengerDto[],
  ): Promise<BookingPassengerSnapshot[]> {
    const snapshots: BookingPassengerSnapshot[] = [];

    for (const passenger of passengers) {
      if (passenger.familyMemberId) {
        const member = await this.prisma.familyMember.findUnique({
          where: { id: passenger.familyMemberId },
        });
        if (!member) {
          throw new NotFoundException('Family member not found');
        }
        if (member.customerId !== customerId) {
          throw new ForbiddenException(
            'This family member does not belong to this customer',
          );
        }
        snapshots.push({
          type: passenger.type,
          firstName: member.firstName,
          lastName: member.lastName,
          dateOfBirth: member.dateOfBirth,
          passportNumber: member.passportNumber,
        });
      } else {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
        });
        if (!customer) {
          throw new NotFoundException('Customer not found');
        }
        snapshots.push({
          type: passenger.type,
          firstName: customer.firstName,
          lastName: customer.lastName,
          dateOfBirth: customer.dateOfBirth,
          passportNumber: customer.passportNumber,
        });
      }
    }

    return snapshots;
  }

  async createBooking(
    customerId: string,
    offerId: string,
    passengerInputs: CreatePassengerDto[],
    bookedByStaffId?: string,
    idempotencyKey?: string,
    expectedPrice?: number,
  ) {
    // Duplicate-submission guard (spec #9) — a retried request with the
    // same key returns the booking that already exists instead of booking
    // (and charging) twice.
    if (idempotencyKey) {
      const existing = await this.prisma.flightBooking.findUnique({
        where: { idempotencyKey },
        include: { passengers: true },
      });
      if (existing) {
        return existing;
      }
    }

    // Never assume a cached search price is still valid (spec #6) —
    // getOffer always refetches from the provider, and if the caller told
    // us what price they last agreed to, a mismatch here means the price
    // moved between revalidation and this call; require an explicit
    // resubmission with the new price rather than silently charging more.
    const offer = await this.getOffer(offerId);
    if (expectedPrice !== undefined && offer.totalAmount !== expectedPrice) {
      throw new ConflictException(
        `The price for this flight has changed from ${expectedPrice} to ${offer.totalAmount} ${offer.currency}. Please review and confirm the new price before booking.`,
      );
    }

    const snapshots = await this.resolvePassengerSnapshots(
      customerId,
      passengerInputs,
    );

    const result = await this.provider.createOrder(offer, snapshots);
    await this.providerLog.record({
      provider: offer.provider,
      operation: ProviderOperation.CREATE_ORDER,
      status:
        result.status === 'CONFIRMED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'CONFIRMED'
          ? `Order created: ${result.providerOrderId}`
          : (result.errorMessage ?? 'This offer is no longer available'),
    });
    if (result.status === 'FAILED') {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }

    const firstLeg = offer.legs[0];
    const lastLeg = offer.legs[offer.legs.length - 1];
    const firstSegment = firstLeg.segments[0];

    const bookedByStaff = bookedByStaffId
      ? await this.prisma.staff.findUnique({ where: { id: bookedByStaffId } })
      : null;

    // Configurable agency markup (spec #18) — never hard-coded. The
    // provider's own price becomes providerCost; totalAmount below is what
    // the customer actually pays, both snapshotted so a later pricing-rule
    // edit never retroactively changes an already-booked price.
    const pricing = await this.pricingService.priceOffer(offer.totalAmount, {
      airlineCode: firstSegment?.airlineCode,
      origin: firstLeg.origin,
      destination: lastLeg.destination,
      cabinClass: offer.cabinClass,
      staffId: bookedByStaffId,
      branchId: bookedByStaff?.branchId ?? undefined,
    });

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.flightBooking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          bookedByStaffId,
          branchId: bookedByStaff?.branchId,
          provider: offer.provider,
          providerOfferId: offer.id,
          providerOrderId: result.providerOrderId,
          status: FlightBookingStatus.CONFIRMED,
          currency: offer.currency,
          totalAmount: pricing.customerPrice,
          providerCost: offer.totalAmount,
          markupAmount: pricing.markupAmount,
          pricingRuleId: pricing.rule?.id,
          idempotencyKey,
          tripType: offer.tripType,
          origin: firstLeg.origin,
          destination: lastLeg.destination,
          departureAt: new Date(firstLeg.departureAt),
          cabinClass: offer.cabinClass,
          itinerary: offer as unknown as Prisma.InputJsonValue,
          providerWarnings: (offer.fareConditions?.warnings ??
            []) as unknown as Prisma.InputJsonValue,
          fareRules: (offer.fareConditions ??
            null) as unknown as Prisma.InputJsonValue,
          refundable:
            offer.fareConditions?.refundable === undefined
              ? null
              : offer.fareConditions.refundable === 'REFUNDABLE',
          baggageAllowance: (offer.fareConditions?.baggageAllowance ??
            null) as unknown as Prisma.InputJsonValue,
          passengers: {
            create: passengerInputs.map((input, index) => ({
              type: snapshots[index].type,
              customerId: input.familyMemberId ? null : customerId,
              familyMemberId: input.familyMemberId ?? null,
              firstName: snapshots[index].firstName,
              lastName: snapshots[index].lastName,
              dateOfBirth: snapshots[index].dateOfBirth,
              passportNumber: snapshots[index].passportNumber,
            })),
          },
        },
        include: { passengers: true },
      });

      await this.invoicesService.createForFlightBooking(created, tx);

      return created;
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true } } },
    });
    if (customer) {
      await this.notificationsService.sendBookingConfirmation(
        customer.identity.email,
        {
          bookingReference: booking.bookingReference,
          origin: booking.origin,
          destination: booking.destination,
          departureAt: booking.departureAt,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
        },
      );
    }

    return booking;
  }

  listForCustomer(customerId: string) {
    return this.prisma.flightBooking.findMany({
      where: { customerId },
      include: { passengers: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; status?: FlightBookingStatus }) {
    return this.prisma.flightBooking.findMany({
      where: filters,
      include: {
        passengers: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Fetches a booking, optionally enforcing that it belongs to `ownerCustomerId`. */
  async getBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id },
      include: { passengers: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (ownerCustomerId && booking.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This booking does not belong to this customer',
      );
    }
    return booking;
  }

  /**
   * Plain pre-ticket cancellation — once a booking is TICKETED, the spec
   * requires the fuller refund-with-penalty flow instead (see
   * FlightRefundsService), which is the only path that can move a
   * TICKETED booking to REFUNDED. This method stays intentionally simple
   * for the reservation/pre-ticket stage, matching its original behavior.
   */
  async cancelBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.getBooking(id, ownerCustomerId);
    if (booking.status === FlightBookingStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }
    if (booking.status === FlightBookingStatus.TICKETED) {
      throw new ConflictException(
        'This booking has already been ticketed — use the refund workflow instead of a plain cancellation.',
      );
    }

    if (booking.providerOrderId) {
      await this.provider.cancelOrder(booking.providerOrderId);
      await this.providerLog.record({
        provider: booking.provider,
        operation: ProviderOperation.CANCEL_ORDER,
        bookingId: booking.id,
        status: ProviderTransactionStatus.SUCCESS,
        safeMessage: 'Order cancelled pre-ticket',
      });
    }

    const cancelled = await this.prisma.flightBooking.update({
      where: { id },
      data: { status: FlightBookingStatus.CANCELLED },
      include: { passengers: true },
    });

    await this.invoicesService.voidIfUnpaid(id);

    return cancelled;
  }
}
