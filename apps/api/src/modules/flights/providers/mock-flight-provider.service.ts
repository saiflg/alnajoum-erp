import { Injectable, Logger } from '@nestjs/common';
import { CabinClass, FlightProviderName, TripType } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightLegOffer,
  FlightOffer,
  FlightProviderPort,
  SearchFlightsCriteria,
} from './flight-provider.port';

const OFFER_TTL_MS = 30 * 60 * 1000; // 30 minutes, matching typical GDS offer TTLs

const AIRLINES: Array<{ name: string; code: string }> = [
  { name: 'Air Peace', code: 'P4' },
  { name: 'Arik Air', code: 'W3' },
  { name: 'Ibom Air', code: 'QI' },
  { name: 'British Airways', code: 'BA' },
  { name: 'Qatar Airways', code: 'QR' },
  { name: 'Ethiopian Airlines', code: 'ET' },
];

const CABIN_MULTIPLIER: Record<CabinClass, number> = {
  ECONOMY: 1,
  PREMIUM_ECONOMY: 1.6,
  BUSINESS: 3.2,
  FIRST: 5,
};

/** djb2 string hash, used to seed the PRNG so identical searches are stable. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG from a numeric seed. */
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

interface CachedOffer {
  offer: FlightOffer;
  expiresAt: number;
}

@Injectable()
export class MockFlightProviderService implements FlightProviderPort {
  private readonly logger = new Logger(MockFlightProviderService.name);
  private readonly offerCache = new Map<string, CachedOffer>();

  searchOffers(criteria: SearchFlightsCriteria): Promise<FlightOffer[]> {
    const cabinClass = criteria.cabinClass ?? CabinClass.ECONOMY;
    // Deliberately excludes tripType: the same legs represent the same
    // underlying flights regardless of how they're bundled, so a round trip
    // and a multi-city search over identical legs see identical per-leg
    // pricing before the round-trip bundle discount is applied below.
    const seedKey = [
      ...criteria.legs.map(
        (leg) => `${leg.origin}|${leg.destination}|${leg.departureDate}`,
      ),
      cabinClass,
    ].join('~');
    const rand = mulberry32(hashString(seedKey));

    const offerCount = randInt(rand, 3, 5);
    const offers: FlightOffer[] = [];

    for (let i = 0; i < offerCount; i += 1) {
      // One carrier operates the whole itinerary for a given offer, same as
      // a real GDS fare family — mixed-carrier itineraries aren't modeled.
      const airline = AIRLINES[randInt(rand, 0, AIRLINES.length - 1)];
      let legsTotal = 0;

      const legs: FlightLegOffer[] = criteria.legs.map((legCriteria) => {
        const durationMinutes = randInt(rand, 70, 420);
        const departHour = randInt(rand, 0, 23);
        const departMinute = randInt(rand, 0, 59);

        const departureAt = new Date(legCriteria.departureDate);
        departureAt.setUTCHours(departHour, departMinute, 0, 0);
        const arrivalAt = new Date(
          departureAt.getTime() + durationMinutes * 60_000,
        );

        const basePrice = randInt(rand, 45_000, 220_000);
        legsTotal += Math.round(basePrice * CABIN_MULTIPLIER[cabinClass]);

        return {
          origin: legCriteria.origin,
          destination: legCriteria.destination,
          departureAt: departureAt.toISOString(),
          arrivalAt: arrivalAt.toISOString(),
          segments: [
            {
              origin: legCriteria.origin,
              destination: legCriteria.destination,
              departureAt: departureAt.toISOString(),
              arrivalAt: arrivalAt.toISOString(),
              airline: airline.name,
              airlineCode: airline.code,
              flightNumber: `${airline.code}${randInt(rand, 100, 999)}`,
              cabinClass,
              durationMinutes,
            },
          ],
        };
      });

      // Bundled round-trip fares are typically priced below two separate
      // one-ways; multi-city itineraries don't get that bundle discount.
      const totalAmount =
        criteria.tripType === TripType.ROUND_TRIP
          ? Math.round(legsTotal * 0.9)
          : legsTotal;

      const offer: FlightOffer = {
        id: randomUUID(),
        provider: FlightProviderName.MOCK,
        tripType: criteria.tripType,
        legs,
        cabinClass,
        currency: 'NGN',
        totalAmount,
        seatsAvailable: randInt(rand, 1, 9),
        expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
      };

      this.offerCache.set(offer.id, {
        offer,
        expiresAt: Date.now() + OFFER_TTL_MS,
      });
      offers.push(offer);
    }

    return Promise.resolve(
      offers.sort((a, b) => a.totalAmount - b.totalAmount),
    );
  }

  getOffer(offerId: string): Promise<FlightOffer | null> {
    const cached = this.offerCache.get(offerId);
    if (!cached) return Promise.resolve(null);
    if (cached.expiresAt < Date.now()) {
      this.offerCache.delete(offerId);
      return Promise.resolve(null);
    }
    return Promise.resolve(cached.offer);
  }

  createOrder(
    offer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult> {
    const cached = this.offerCache.get(offer.id);
    if (!cached || cached.expiresAt < Date.now()) {
      return Promise.resolve({ providerOrderId: '', status: 'FAILED' });
    }
    this.logger.log(
      `Mock order created for offer ${offer.id} with ${passengers.length} passenger(s)`,
    );
    // Offers are single-use in a real GDS; drop it from the cache once booked.
    this.offerCache.delete(offer.id);
    return Promise.resolve({
      providerOrderId: `MOCK-${randomUUID()}`,
      status: 'CONFIRMED',
    });
  }

  cancelOrder(providerOrderId: string): Promise<void> {
    this.logger.log(`Mock order ${providerOrderId} cancelled`);
    return Promise.resolve();
  }
}
