import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlightBookingStatus, Prisma, TripType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreatePassengerDto } from './dto/create-passenger.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type {
  BookingPassengerSnapshot,
  FlightOffer,
  FlightProviderPort,
} from './providers/flight-provider.port';

function generateBookingReference(): string {
  return `ANJ-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class FlightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
  ) {}

  async search(dto: SearchFlightsDto): Promise<FlightOffer[]> {
    this.validateLegCount(dto.tripType, dto.legs.length);

    return this.provider.searchOffers({
      tripType: dto.tripType,
      legs: dto.legs,
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
      cabinClass: dto.cabinClass,
    });
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
  ) {
    const offer = await this.getOffer(offerId);
    const snapshots = await this.resolvePassengerSnapshots(
      customerId,
      passengerInputs,
    );

    const result = await this.provider.createOrder(offer, snapshots);
    if (result.status === 'FAILED') {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }

    const firstLeg = offer.legs[0];
    const lastLeg = offer.legs[offer.legs.length - 1];

    return this.prisma.flightBooking.create({
      data: {
        bookingReference: generateBookingReference(),
        customerId,
        bookedByStaffId,
        provider: offer.provider,
        providerOfferId: offer.id,
        providerOrderId: result.providerOrderId,
        status: FlightBookingStatus.CONFIRMED,
        currency: offer.currency,
        totalAmount: offer.totalAmount,
        tripType: offer.tripType,
        origin: firstLeg.origin,
        destination: lastLeg.destination,
        departureAt: new Date(firstLeg.departureAt),
        cabinClass: offer.cabinClass,
        itinerary: offer as unknown as Prisma.InputJsonValue,
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

  async cancelBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.getBooking(id, ownerCustomerId);
    if (booking.status === FlightBookingStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }

    if (booking.providerOrderId) {
      await this.provider.cancelOrder(booking.providerOrderId);
    }

    return this.prisma.flightBooking.update({
      where: { id },
      data: { status: FlightBookingStatus.CANCELLED },
      include: { passengers: true },
    });
  }
}
