import { Injectable, Logger } from '@nestjs/common';
import { HotelProviderName } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  CreateOrderResult,
  HotelOffer,
  HotelProviderPort,
  SearchHotelsCriteria,
} from './hotel-provider.port';

const OFFER_TTL_MS = 30 * 60 * 1000; // 30 minutes, matching MockFlightProviderService

const HOTEL_NAMES = [
  'Grand Cavalli Hotel',
  'Zaphire Suites',
  'Sunview International Hotel',
  'Kaduna Continental',
  'Riverpark Hotel & Suites',
  'Emerald Palm Hotel',
];

const ROOM_TYPES = ['Standard Room', 'Deluxe Room', 'Executive Suite', 'Family Room'];

const AMENITY_POOL = [
  'Free WiFi',
  'Swimming Pool',
  'Airport Shuttle',
  'Breakfast Included',
  'Gym',
  '24-Hour Front Desk',
  'Conference Room',
  'Air Conditioning',
];

/** djb2 hash + mulberry32, identical to MockFlightProviderService — same
 * "stable for identical searches" property. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
}

interface CachedOffer {
  offer: HotelOffer;
  expiresAt: number;
}

@Injectable()
export class MockHotelProviderService implements HotelProviderPort {
  private readonly logger = new Logger(MockHotelProviderService.name);
  private readonly offerCache = new Map<string, CachedOffer>();

  searchOffers(criteria: SearchHotelsCriteria): Promise<HotelOffer[]> {
    const seedKey = [
      criteria.city.toLowerCase(),
      criteria.checkInDate,
      criteria.checkOutDate,
      criteria.rooms,
      criteria.guests,
    ].join('~');
    const rand = mulberry32(hashString(seedKey));
    const nights = nightsBetween(criteria.checkInDate, criteria.checkOutDate);

    const offerCount = randInt(rand, 3, 6);
    const offers: HotelOffer[] = [];
    const usedNames = new Set<string>();

    for (let i = 0; i < offerCount; i += 1) {
      let hotelName = HOTEL_NAMES[randInt(rand, 0, HOTEL_NAMES.length - 1)];
      // Avoid two identical hotel names in the same result set.
      let attempts = 0;
      while (usedNames.has(hotelName) && attempts < HOTEL_NAMES.length) {
        hotelName = HOTEL_NAMES[randInt(rand, 0, HOTEL_NAMES.length - 1)];
        attempts += 1;
      }
      usedNames.add(hotelName);

      const starRating = randInt(rand, 3, 5);
      const roomType = ROOM_TYPES[randInt(rand, 0, ROOM_TYPES.length - 1)];
      const perNightRate = randInt(rand, 25_000, 120_000) * (starRating - 2);
      const totalAmount = perNightRate * nights * criteria.rooms;

      const amenityCount = randInt(rand, 3, 5);
      const amenities: string[] = [];
      while (amenities.length < amenityCount) {
        const candidate = AMENITY_POOL[randInt(rand, 0, AMENITY_POOL.length - 1)];
        if (!amenities.includes(candidate)) amenities.push(candidate);
      }

      const offer: HotelOffer = {
        id: randomUUID(),
        provider: HotelProviderName.MOCK,
        hotelName,
        city: criteria.city,
        country: 'Nigeria',
        starRating,
        roomType,
        checkInDate: criteria.checkInDate,
        checkOutDate: criteria.checkOutDate,
        rooms: criteria.rooms,
        guests: criteria.guests,
        currency: 'NGN',
        totalAmount,
        amenities,
        expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
      };

      this.offerCache.set(offer.id, { offer, expiresAt: Date.now() + OFFER_TTL_MS });
      offers.push(offer);
    }

    return Promise.resolve(offers.sort((a, b) => a.totalAmount - b.totalAmount));
  }

  getOffer(offerId: string): Promise<HotelOffer | null> {
    const cached = this.offerCache.get(offerId);
    if (!cached) return Promise.resolve(null);
    if (cached.expiresAt < Date.now()) {
      this.offerCache.delete(offerId);
      return Promise.resolve(null);
    }
    return Promise.resolve(cached.offer);
  }

  createOrder(offer: HotelOffer): Promise<CreateOrderResult> {
    const cached = this.offerCache.get(offer.id);
    if (!cached || cached.expiresAt < Date.now()) {
      return Promise.resolve({ providerOrderId: '', status: 'FAILED' });
    }
    this.logger.log(`Mock hotel order created for offer ${offer.id} (${offer.hotelName})`);
    this.offerCache.delete(offer.id);
    return Promise.resolve({ providerOrderId: `MOCK-${randomUUID()}`, status: 'CONFIRMED' });
  }

  cancelOrder(providerOrderId: string): Promise<void> {
    this.logger.log(`Mock hotel order ${providerOrderId} cancelled`);
    return Promise.resolve();
  }
}
