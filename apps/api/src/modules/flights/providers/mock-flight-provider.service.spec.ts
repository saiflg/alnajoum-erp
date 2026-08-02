import { Test, TestingModule } from '@nestjs/testing';
import { CabinClass, TripType } from '@prisma/client';
import { MockFlightProviderService } from './mock-flight-provider.service';

const ONE_WAY = {
  tripType: TripType.ONE_WAY,
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-01-10' }],
  adults: 1,
};

const ROUND_TRIP = {
  tripType: TripType.ROUND_TRIP,
  legs: [
    { origin: 'LOS', destination: 'ABV', departureDate: '2027-01-10' },
    { origin: 'ABV', destination: 'LOS', departureDate: '2027-01-20' },
  ],
  adults: 1,
};

const MULTI_CITY = {
  tripType: TripType.MULTI_CITY,
  legs: [
    { origin: 'LOS', destination: 'ABV', departureDate: '2027-01-10' },
    { origin: 'ABV', destination: 'KAN', departureDate: '2027-01-13' },
    { origin: 'KAN', destination: 'LOS', departureDate: '2027-01-17' },
  ],
  adults: 1,
};

describe('MockFlightProviderService', () => {
  let service: MockFlightProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockFlightProviderService],
    }).compile();

    service = module.get(MockFlightProviderService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('searchOffers', () => {
    it('returns between 3 and 5 offers sorted by ascending price', async () => {
      const offers = await service.searchOffers(ONE_WAY);

      expect(offers.length).toBeGreaterThanOrEqual(3);
      expect(offers.length).toBeLessThanOrEqual(5);
      const prices = offers.map((o) => o.totalAmount);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('is deterministic: identical criteria produce the same offer content', async () => {
      const first = await service.searchOffers(MULTI_CITY);
      const second = await service.searchOffers(MULTI_CITY);

      expect(second.map((o) => o.totalAmount)).toEqual(
        first.map((o) => o.totalAmount),
      );
      expect(second.map((o) => o.legs[0].segments[0].airline)).toEqual(
        first.map((o) => o.legs[0].segments[0].airline),
      );
    });

    it('returns exactly one leg for a one-way search', async () => {
      const offers = await service.searchOffers(ONE_WAY);

      expect(offers[0].legs).toHaveLength(1);
      expect(offers[0].legs[0].origin).toBe('LOS');
      expect(offers[0].legs[0].destination).toBe('ABV');
    });

    it('returns the outbound and return legs for a round trip', async () => {
      const offers = await service.searchOffers(ROUND_TRIP);

      expect(offers[0].legs).toHaveLength(2);
      expect(offers[0].legs[0].origin).toBe('LOS');
      expect(offers[0].legs[0].destination).toBe('ABV');
      expect(offers[0].legs[1].origin).toBe('ABV');
      expect(offers[0].legs[1].destination).toBe('LOS');
    });

    it('returns every requested leg in order for a multi-city trip', async () => {
      const offers = await service.searchOffers(MULTI_CITY);

      expect(offers[0].legs).toHaveLength(3);
      expect(offers[0].legs.map((l) => `${l.origin}-${l.destination}`)).toEqual(
        ['LOS-ABV', 'ABV-KAN', 'KAN-LOS'],
      );
    });

    it('prices a round trip 10% below the same legs booked as multi-city', async () => {
      const roundTrip = await service.searchOffers(ROUND_TRIP);
      const sameLegsMultiCity = await service.searchOffers({
        tripType: TripType.MULTI_CITY,
        legs: ROUND_TRIP.legs,
        adults: 1,
      });

      expect(roundTrip[0].totalAmount).toBe(
        Math.round(sameLegsMultiCity[0].totalAmount * 0.9),
      );
    });

    it('prices business class higher than economy for the same route', async () => {
      const economy = await service.searchOffers({
        ...ONE_WAY,
        cabinClass: CabinClass.ECONOMY,
      });
      const business = await service.searchOffers({
        ...ONE_WAY,
        cabinClass: CabinClass.BUSINESS,
      });

      expect(business[0].totalAmount).toBeGreaterThan(economy[0].totalAmount);
    });
  });

  describe('getOffer', () => {
    it('returns null for an unknown offer id', async () => {
      await expect(service.getOffer('does-not-exist')).resolves.toBeNull();
    });

    it('returns the offer immediately after it was searched', async () => {
      const [offer] = await service.searchOffers(ONE_WAY);

      await expect(service.getOffer(offer.id)).resolves.toEqual(offer);
    });

    it('returns null once the offer has expired', async () => {
      jest.useFakeTimers();
      const [offer] = await service.searchOffers(ONE_WAY);

      jest.advanceTimersByTime(31 * 60 * 1000);

      await expect(service.getOffer(offer.id)).resolves.toBeNull();
    });
  });

  describe('createOrder / cancelOrder', () => {
    it('confirms an order for a valid, cached offer and consumes it', async () => {
      const [offer] = await service.searchOffers(ONE_WAY);

      const result = await service.createOrder(offer, [
        { type: 'ADULT', firstName: 'A', lastName: 'B' },
      ]);

      expect(result.status).toBe('CONFIRMED');
      expect(result.providerOrderId).toMatch(/^MOCK-/);
      // Offers are single-use, like a real GDS.
      await expect(service.getOffer(offer.id)).resolves.toBeNull();
    });

    it('fails to create an order for an offer that is no longer cached', async () => {
      const [offer] = await service.searchOffers(ONE_WAY);
      await service.createOrder(offer, [
        { type: 'ADULT', firstName: 'A', lastName: 'B' },
      ]);

      const result = await service.createOrder(offer, [
        { type: 'ADULT', firstName: 'A', lastName: 'B' },
      ]);

      expect(result.status).toBe('FAILED');
    });

    it('resolves without throwing for cancelOrder', async () => {
      await expect(
        service.cancelOrder('MOCK-anything'),
      ).resolves.toBeUndefined();
    });
  });
});
