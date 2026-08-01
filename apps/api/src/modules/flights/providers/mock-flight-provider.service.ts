import { Injectable, Logger } from '@nestjs/common';
import { CabinClass, FlightProviderName } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightOffer,
  FlightProviderPort,
  FlightSegment,
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
    const seedKey = [
      criteria.origin,
      criteria.destination,
      criteria.departureDate,
      criteria.returnDate ?? '',
      cabinClass,
    ].join('|');
    const rand = mulberry32(hashString(seedKey));

    const offerCount = randInt(rand, 3, 5);
    const offers: FlightOffer[] = [];

    for (let i = 0; i < offerCount; i += 1) {
      const airline = AIRLINES[randInt(rand, 0, AIRLINES.length - 1)];
      const outboundDurationMinutes = randInt(rand, 70, 420);
      const outboundDepartHour = randInt(rand, 0, 23);
      const outboundDepartMinute = randInt(rand, 0, 59);

      const departureAt = new Date(criteria.departureDate);
      departureAt.setUTCHours(outboundDepartHour, outboundDepartMinute, 0, 0);
      const arrivalAt = new Date(
        departureAt.getTime() + outboundDurationMinutes * 60_000,
      );

      const outboundSegments: FlightSegment[] = [
        {
          origin: criteria.origin,
          destination: criteria.destination,
          departureAt: departureAt.toISOString(),
          arrivalAt: arrivalAt.toISOString(),
          airline: airline.name,
          airlineCode: airline.code,
          flightNumber: `${airline.code}${randInt(rand, 100, 999)}`,
          cabinClass,
          durationMinutes: outboundDurationMinutes,
        },
      ];

      let returnSegments: FlightSegment[] | undefined;
      let returnDepartureAt: string | undefined;
      let returnArrivalAt: string | undefined;

      if (criteria.returnDate) {
        const returnDurationMinutes = randInt(rand, 70, 420);
        const returnDepartHour = randInt(rand, 0, 23);
        const returnDepartMinute = randInt(rand, 0, 59);
        const returnDeparture = new Date(criteria.returnDate);
        returnDeparture.setUTCHours(returnDepartHour, returnDepartMinute, 0, 0);
        const returnArrival = new Date(
          returnDeparture.getTime() + returnDurationMinutes * 60_000,
        );

        returnDepartureAt = returnDeparture.toISOString();
        returnArrivalAt = returnArrival.toISOString();
        returnSegments = [
          {
            origin: criteria.destination,
            destination: criteria.origin,
            departureAt: returnDepartureAt,
            arrivalAt: returnArrivalAt,
            airline: airline.name,
            airlineCode: airline.code,
            flightNumber: `${airline.code}${randInt(rand, 100, 999)}`,
            cabinClass,
            durationMinutes: returnDurationMinutes,
          },
        ];
      }

      const basePrice = randInt(rand, 45_000, 220_000);
      const roundTripFactor = criteria.returnDate ? 1.8 : 1;
      const totalAmount = Math.round(
        basePrice * CABIN_MULTIPLIER[cabinClass] * roundTripFactor,
      );

      const offer: FlightOffer = {
        id: randomUUID(),
        provider: FlightProviderName.MOCK,
        origin: criteria.origin,
        destination: criteria.destination,
        departureAt: outboundSegments[0].departureAt,
        arrivalAt: outboundSegments[0].arrivalAt,
        returnDepartureAt,
        returnArrivalAt,
        cabinClass,
        currency: 'NGN',
        totalAmount,
        seatsAvailable: randInt(rand, 1, 9),
        outboundSegments,
        returnSegments,
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
