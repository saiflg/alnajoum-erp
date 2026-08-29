import { Injectable, Logger } from '@nestjs/common';
import { VehicleRentalProviderName, VehicleType } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  CreateOrderResult,
  SearchVehicleRentalsCriteria,
  VehicleRentalOffer,
  VehicleRentalProviderPort,
} from './vehicle-rental-provider.port';

const OFFER_TTL_MS = 30 * 60 * 1000;

const VEHICLES: Record<VehicleType, Array<{ name: string; seats: number; rateMultiplier: number }>> = {
  CAR: [
    { name: 'Toyota Camry', seats: 4, rateMultiplier: 1 },
    { name: 'Toyota Corolla', seats: 4, rateMultiplier: 0.85 },
    { name: 'Lexus RX350', seats: 4, rateMultiplier: 1.8 },
    { name: 'Toyota Land Cruiser Prado', seats: 6, rateMultiplier: 2.2 },
  ],
  VAN: [
    { name: 'Toyota Hiace (14-seater)', seats: 14, rateMultiplier: 1.6 },
    { name: 'Toyota Sienna', seats: 7, rateMultiplier: 1.3 },
  ],
  BUS: [
    { name: 'Toyota Coaster (30-seater)', seats: 30, rateMultiplier: 3.2 },
    { name: 'Marcopolo Coach (50-seater)', seats: 50, rateMultiplier: 5 },
  ],
};

const FEATURE_POOL = ['Air Conditioning', 'GPS Tracking', 'Insurance Included', 'Unlimited Mileage'];

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

function hoursBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / (60 * 60 * 1000)));
}

interface CachedOffer {
  offer: VehicleRentalOffer;
  expiresAt: number;
}

@Injectable()
export class MockVehicleRentalProviderService implements VehicleRentalProviderPort {
  private readonly logger = new Logger(MockVehicleRentalProviderService.name);
  private readonly offerCache = new Map<string, CachedOffer>();

  searchOffers(criteria: SearchVehicleRentalsCriteria): Promise<VehicleRentalOffer[]> {
    const withDriver = criteria.withDriver ?? true;
    const seedKey = [
      criteria.vehicleType,
      criteria.pickupCity.toLowerCase(),
      criteria.pickupAt,
      criteria.dropoffAt,
      withDriver,
    ].join('~');
    const rand = mulberry32(hashString(seedKey));
    const hours = hoursBetween(criteria.pickupAt, criteria.dropoffAt);
    const days = Math.max(1, Math.ceil(hours / 24));

    const catalogue = VEHICLES[criteria.vehicleType];
    const offers: VehicleRentalOffer[] = [];

    for (const vehicle of catalogue) {
      const baseDailyRate = randInt(rand, 30_000, 60_000) * vehicle.rateMultiplier;
      const driverFee = withDriver ? randInt(rand, 5_000, 10_000) * days : 0;
      const totalAmount = Math.round(baseDailyRate * days + driverFee);

      const featureCount = randInt(rand, 2, FEATURE_POOL.length);
      const features: string[] = [];
      while (features.length < featureCount) {
        const candidate = FEATURE_POOL[randInt(rand, 0, FEATURE_POOL.length - 1)];
        if (!features.includes(candidate)) features.push(candidate);
      }

      const offer: VehicleRentalOffer = {
        id: randomUUID(),
        provider: VehicleRentalProviderName.MOCK,
        vehicleType: criteria.vehicleType,
        vehicleName: vehicle.name,
        pickupCity: criteria.pickupCity,
        pickupAt: criteria.pickupAt,
        dropoffAt: criteria.dropoffAt,
        withDriver,
        seats: vehicle.seats,
        currency: 'NGN',
        totalAmount,
        features,
        expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
      };

      this.offerCache.set(offer.id, { offer, expiresAt: Date.now() + OFFER_TTL_MS });
      offers.push(offer);
    }

    return Promise.resolve(offers.sort((a, b) => a.totalAmount - b.totalAmount));
  }

  getOffer(offerId: string): Promise<VehicleRentalOffer | null> {
    const cached = this.offerCache.get(offerId);
    if (!cached) return Promise.resolve(null);
    if (cached.expiresAt < Date.now()) {
      this.offerCache.delete(offerId);
      return Promise.resolve(null);
    }
    return Promise.resolve(cached.offer);
  }

  createOrder(offer: VehicleRentalOffer): Promise<CreateOrderResult> {
    const cached = this.offerCache.get(offer.id);
    if (!cached || cached.expiresAt < Date.now()) {
      return Promise.resolve({ providerOrderId: '', status: 'FAILED' });
    }
    this.logger.log(`Mock vehicle rental order created for offer ${offer.id} (${offer.vehicleName})`);
    this.offerCache.delete(offer.id);
    return Promise.resolve({ providerOrderId: `MOCK-${randomUUID()}`, status: 'CONFIRMED' });
  }

  cancelOrder(providerOrderId: string): Promise<void> {
    this.logger.log(`Mock vehicle rental order ${providerOrderId} cancelled`);
    return Promise.resolve();
  }
}
