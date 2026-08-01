import { Test, TestingModule } from '@nestjs/testing';
import { CabinClass } from '@prisma/client';
import { MockFlightProviderService } from './mock-flight-provider.service';

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
      const offers = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      });

      expect(offers.length).toBeGreaterThanOrEqual(3);
      expect(offers.length).toBeLessThanOrEqual(5);
      const prices = offers.map((o) => o.totalAmount);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('is deterministic: identical criteria produce the same offer content', async () => {
      const criteria = {
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      };

      const first = await service.searchOffers(criteria);
      const second = await service.searchOffers(criteria);

      expect(second.map((o) => o.totalAmount)).toEqual(
        first.map((o) => o.totalAmount),
      );
      expect(second.map((o) => o.outboundSegments[0].airline)).toEqual(
        first.map((o) => o.outboundSegments[0].airline),
      );
    });

    it('includes return segments when a returnDate is given', async () => {
      const offers = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        returnDate: '2027-01-20',
        adults: 1,
      });

      expect(offers[0].returnSegments).toBeDefined();
      expect(offers[0].returnSegments?.[0].origin).toBe('ABV');
      expect(offers[0].returnSegments?.[0].destination).toBe('LOS');
    });

    it('prices business class higher than economy for the same route', async () => {
      const economy = await service.searchOffers({
        origin: 'LOS',
        destination: 'LHR',
        departureDate: '2027-03-01',
        adults: 1,
        cabinClass: CabinClass.ECONOMY,
      });
      const business = await service.searchOffers({
        origin: 'LOS',
        destination: 'LHR',
        departureDate: '2027-03-01',
        adults: 1,
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
      const [offer] = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      });

      await expect(service.getOffer(offer.id)).resolves.toEqual(offer);
    });

    it('returns null once the offer has expired', async () => {
      jest.useFakeTimers();
      const [offer] = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      });

      jest.advanceTimersByTime(31 * 60 * 1000);

      await expect(service.getOffer(offer.id)).resolves.toBeNull();
    });
  });

  describe('createOrder / cancelOrder', () => {
    it('confirms an order for a valid, cached offer and consumes it', async () => {
      const [offer] = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      });

      const result = await service.createOrder(offer, [
        { type: 'ADULT', firstName: 'A', lastName: 'B' },
      ]);

      expect(result.status).toBe('CONFIRMED');
      expect(result.providerOrderId).toMatch(/^MOCK-/);
      // Offers are single-use, like a real GDS.
      await expect(service.getOffer(offer.id)).resolves.toBeNull();
    });

    it('fails to create an order for an offer that is no longer cached', async () => {
      const [offer] = await service.searchOffers({
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2027-01-10',
        adults: 1,
      });
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
