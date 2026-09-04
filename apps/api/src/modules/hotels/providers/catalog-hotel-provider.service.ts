import { Injectable } from '@nestjs/common';
import { HotelProviderName, HotelStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateOrderResult,
  HotelOffer,
  HotelProviderPort,
  SearchHotelsCriteria,
} from './hotel-provider.port';

/** How long a catalog offer id stays valid before a re-search is required —
 * matches the mock provider's OFFER_TTL_MS convention. */
const OFFER_TTL_MS = 30 * 60 * 1000;

/**
 * The "Manual hotel inventory" branch of the provider abstraction (spec
 * #4) — searches/books against the admin-managed Hotel/HotelRoomType
 * catalog instead of a remote API, through the exact same
 * HotelProviderPort every other provider implements. Offer ids are
 * synthesized as `${roomTypeId}::${checkIn}::${checkOut}::${rooms}` so
 * getOffer/createOrder can recompute the same offer deterministically
 * without a server-side cache (the catalog itself is the source of truth,
 * unlike the mock provider's random-offer cache).
 */
@Injectable()
export class CatalogHotelProviderService implements HotelProviderPort {
  constructor(private readonly prisma: PrismaService) {}

  private nights(checkIn: string, checkOut: string): number {
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  }

  private encodeOfferId(
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
    rooms: number,
  ): string {
    return `${roomTypeId}::${checkIn}::${checkOut}::${rooms}`;
  }

  private decodeOfferId(offerId: string): {
    roomTypeId: string;
    checkIn: string;
    checkOut: string;
    rooms: number;
  } | null {
    const parts = offerId.split('::');
    if (parts.length !== 4) return null;
    const [roomTypeId, checkIn, checkOut, roomsStr] = parts;
    const rooms = Number(roomsStr);
    if (!roomTypeId || !checkIn || !checkOut || !Number.isFinite(rooms))
      return null;
    return { roomTypeId, checkIn, checkOut, rooms };
  }

  private async toOffer(
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
    rooms: number,
  ): Promise<HotelOffer | null> {
    const roomType = await this.prisma.hotelRoomType.findUnique({
      where: { id: roomTypeId },
      include: { hotel: true },
    });
    if (
      !roomType ||
      !roomType.isActive ||
      roomType.hotel.status !== HotelStatus.ACTIVE
    ) {
      return null;
    }
    const nights = this.nights(checkIn, checkOut);
    return {
      id: this.encodeOfferId(roomTypeId, checkIn, checkOut, rooms),
      provider: HotelProviderName.CATALOG,
      hotelName: roomType.hotel.name,
      city: roomType.hotel.city,
      country: roomType.hotel.country,
      starRating: roomType.hotel.starRating,
      roomType: roomType.name,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      rooms,
      guests: roomType.capacity * rooms,
      currency: roomType.currency,
      totalAmount: roomType.sellingPrice * nights * rooms,
      amenities: roomType.hotel.amenities,
      expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
    };
  }

  async searchOffers(criteria: SearchHotelsCriteria): Promise<HotelOffer[]> {
    const roomTypes = await this.prisma.hotelRoomType.findMany({
      where: {
        isActive: true,
        capacity: { gte: 1 },
        hotel: {
          status: HotelStatus.ACTIVE,
          city: { equals: criteria.city, mode: 'insensitive' },
        },
      },
      include: { hotel: true },
    });
    const offers: HotelOffer[] = [];
    for (const rt of roomTypes) {
      if (rt.capacity * criteria.rooms < criteria.guests) continue; // not enough capacity
      if (rt.totalRooms < criteria.rooms) continue; // not enough rooms available
      const offer = await this.toOffer(
        rt.id,
        criteria.checkInDate,
        criteria.checkOutDate,
        criteria.rooms,
      );
      if (offer) offers.push(offer);
    }
    return offers.sort((a, b) => a.totalAmount - b.totalAmount);
  }

  async getOffer(offerId: string): Promise<HotelOffer | null> {
    const decoded = this.decodeOfferId(offerId);
    if (!decoded) return null;
    return this.toOffer(
      decoded.roomTypeId,
      decoded.checkIn,
      decoded.checkOut,
      decoded.rooms,
    );
  }

  async createOrder(offer: HotelOffer): Promise<CreateOrderResult> {
    const fresh = await this.getOffer(offer.id);
    if (!fresh) {
      return { providerOrderId: '', status: 'FAILED' };
    }
    return {
      providerOrderId: `CATALOG-${offer.id}-${Date.now()}`,
      status: 'CONFIRMED',
    };
  }

  cancelOrder(_providerOrderId: string): Promise<void> {
    // No external order to cancel — the catalog has no availability hold
    // to release beyond what HotelsService itself tracks.
    return Promise.resolve();
  }
}
