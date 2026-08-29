import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleRentalStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { SearchVehicleRentalsDto } from './dto/search-vehicle-rentals.dto';
import { VEHICLE_RENTAL_PROVIDER } from './providers/vehicle-rental-provider.port';
import type {
  VehicleRentalOffer,
  VehicleRentalProviderPort,
} from './providers/vehicle-rental-provider.port';

function generateBookingReference(): string {
  return `VEH-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class VehicleRentalsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(VEHICLE_RENTAL_PROVIDER) private readonly provider: VehicleRentalProviderPort,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async search(dto: SearchVehicleRentalsDto): Promise<VehicleRentalOffer[]> {
    if (new Date(dto.dropoffAt) <= new Date(dto.pickupAt)) {
      throw new ConflictException('Drop-off time must be after pickup time');
    }
    return this.provider.searchOffers({
      vehicleType: dto.vehicleType,
      pickupCity: dto.pickupCity,
      pickupAt: dto.pickupAt,
      dropoffAt: dto.dropoffAt,
      withDriver: dto.withDriver,
    });
  }

  async getOffer(offerId: string): Promise<VehicleRentalOffer> {
    const offer = await this.provider.getOffer(offerId);
    if (!offer) {
      throw new NotFoundException('This vehicle offer has expired or does not exist');
    }
    return offer;
  }

  async createBooking(customerId: string, offerId: string, bookedByStaffId?: string) {
    const offer = await this.getOffer(offerId);

    const result = await this.provider.createOrder(offer);
    if (result.status === 'FAILED') {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vehicleRental.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          bookedByStaffId,
          provider: offer.provider,
          providerOfferId: offer.id,
          providerOrderId: result.providerOrderId,
          status: VehicleRentalStatus.CONFIRMED,
          currency: offer.currency,
          totalAmount: offer.totalAmount,
          vehicleType: offer.vehicleType,
          vehicleName: offer.vehicleName,
          pickupCity: offer.pickupCity,
          pickupLocation: offer.pickupCity,
          dropoffLocation: offer.pickupCity,
          pickupAt: new Date(offer.pickupAt),
          dropoffAt: new Date(offer.dropoffAt),
          withDriver: offer.withDriver,
          offerSnapshot: offer as unknown as Prisma.InputJsonValue,
        },
      });

      await this.invoicesService.createForVehicleRental(created, tx);

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
          origin: booking.vehicleName,
          destination: booking.pickupCity,
          departureAt: booking.pickupAt,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
        },
      );
    }

    return booking;
  }

  listForCustomer(customerId: string) {
    return this.prisma.vehicleRental.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; status?: VehicleRentalStatus }) {
    return this.prisma.vehicleRental.findMany({
      where: filters,
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.prisma.vehicleRental.findUnique({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (ownerCustomerId && booking.customerId !== ownerCustomerId) {
      throw new ForbiddenException('This booking does not belong to this customer');
    }
    return booking;
  }

  async cancelBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.getBooking(id, ownerCustomerId);
    if (booking.status === VehicleRentalStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }

    if (booking.providerOrderId) {
      await this.provider.cancelOrder(booking.providerOrderId);
    }

    const cancelled = await this.prisma.vehicleRental.update({
      where: { id },
      data: { status: VehicleRentalStatus.CANCELLED },
    });

    await this.invoicesService.voidVehicleRentalIfUnpaid(id);

    return cancelled;
  }
}
