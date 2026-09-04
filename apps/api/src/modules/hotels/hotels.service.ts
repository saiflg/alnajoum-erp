import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingStatus, HotelProviderName, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { SearchHotelsDto } from './dto/search-hotels.dto';
import { HOTEL_PROVIDER } from './providers/hotel-provider.port';
import type {
  HotelOffer,
  HotelProviderPort,
} from './providers/hotel-provider.port';

function generateBookingReference(): string {
  return `HTL-${randomBytes(4).toString('hex').toUpperCase()}`;
}

interface GuestInput {
  firstName: string;
  lastName: string;
  familyMemberId?: string;
}

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(HOTEL_PROVIDER) private readonly provider: HotelProviderPort,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async search(dto: SearchHotelsDto): Promise<HotelOffer[]> {
    if (new Date(dto.checkOutDate) <= new Date(dto.checkInDate)) {
      throw new ConflictException('Check-out date must be after check-in date');
    }
    return this.provider.searchOffers({
      city: dto.city,
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      rooms: dto.rooms,
      guests: dto.guests,
    });
  }

  async getOffer(offerId: string): Promise<HotelOffer> {
    const offer = await this.provider.getOffer(offerId);
    if (!offer) {
      throw new NotFoundException(
        'This hotel offer has expired or does not exist',
      );
    }
    return offer;
  }

  /** For a CATALOG offer, the offer id encodes the roomTypeId — this
   * recovers the supplierCost snapshot the offer was priced from, same
   * "never recompute later" principle as VisaApplication's cost snapshot. */
  private async resolveSupplierCost(offer: HotelOffer): Promise<{
    supplierCost: number | null;
    roomTypeId: string | null;
    hotelId: string | null;
  }> {
    if (offer.provider !== HotelProviderName.CATALOG) {
      return { supplierCost: null, roomTypeId: null, hotelId: null };
    }
    const roomTypeId = offer.id.split('::')[0];
    const roomType = await this.prisma.hotelRoomType.findUnique({
      where: { id: roomTypeId },
    });
    if (!roomType)
      return { supplierCost: null, roomTypeId: null, hotelId: null };
    const nights = Math.max(
      1,
      Math.round(
        (new Date(offer.checkOutDate).getTime() -
          new Date(offer.checkInDate).getTime()) /
          86_400_000,
      ),
    );
    return {
      supplierCost: roomType.supplierCost * nights * offer.rooms,
      roomTypeId: roomType.id,
      hotelId: roomType.hotelId,
    };
  }

  async createBooking(
    customerId: string,
    offerId: string,
    bookedByStaffId?: string,
    guests?: GuestInput[],
    idempotencyKey?: string,
    branchId?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.hotelBooking.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;
    }

    const offer = await this.getOffer(offerId);

    const result = await this.provider.createOrder(offer);
    if (result.status === 'FAILED') {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }

    const { supplierCost, roomTypeId, hotelId } =
      await this.resolveSupplierCost(offer);
    const markupAmount =
      supplierCost != null ? offer.totalAmount - supplierCost : null;

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hotelBooking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          bookedByStaffId,
          branchId,
          provider: offer.provider,
          providerOfferId: offer.id,
          providerOrderId: result.providerOrderId,
          status: HotelBookingStatus.CONFIRMED,
          currency: offer.currency,
          totalAmount: offer.totalAmount,
          hotelName: offer.hotelName,
          city: offer.city,
          country: offer.country,
          starRating: offer.starRating,
          roomType: offer.roomType,
          checkInDate: new Date(offer.checkInDate),
          checkOutDate: new Date(offer.checkOutDate),
          rooms: offer.rooms,
          guests: offer.guests,
          offerSnapshot: offer as unknown as Prisma.InputJsonValue,
          hotelId,
          roomTypeId,
          supplierCost,
          markupAmount,
          idempotencyKey,
          guestRecords: guests
            ? {
                create: guests.map((g) => ({
                  firstName: g.firstName,
                  lastName: g.lastName,
                  customerId: g.familyMemberId ? null : customerId,
                  familyMemberId: g.familyMemberId ?? null,
                })),
              }
            : undefined,
        },
      });

      await this.invoicesService.createForHotelBooking(created, tx);

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
          origin: booking.hotelName,
          destination: booking.city,
          departureAt: booking.checkInDate,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
        },
      );
    }

    return booking;
  }

  /** Staff-only manual/offline booking (spec #23) — always reasoned and
   * always audited via the isOfflineEntry/offlineReason fields, same
   * pattern as VisaApplication's staff-only offline entry. */
  async createManualBooking(
    customerId: string,
    offerId: string,
    bookedByStaffId: string,
    offlineReason: string,
    guests?: GuestInput[],
  ) {
    const booking = await this.createBooking(
      customerId,
      offerId,
      bookedByStaffId,
      guests,
    );
    return this.prisma.hotelBooking.update({
      where: { id: booking.id },
      data: { isOfflineEntry: true, offlineReason },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.hotelBooking.findMany({
      where: { customerId },
      include: { guestRecords: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; status?: HotelBookingStatus }) {
    return this.prisma.hotelBooking.findMany({
      where: filters,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        guestRecords: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.prisma.hotelBooking.findUnique({
      where: { id },
      include: { guestRecords: true },
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
    if (booking.status === HotelBookingStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }
    if (booking.status === HotelBookingStatus.COMPLETED) {
      throw new ConflictException(
        'This booking has already been completed — use the refund workflow instead of a plain cancellation.',
      );
    }

    if (booking.providerOrderId) {
      await this.provider.cancelOrder(booking.providerOrderId);
    }

    const cancelled = await this.prisma.hotelBooking.update({
      where: { id },
      data: { status: HotelBookingStatus.CANCELLED },
    });

    await this.invoicesService.voidHotelBookingIfUnpaid(id);

    return cancelled;
  }
}
