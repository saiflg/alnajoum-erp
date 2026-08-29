import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from '../../integrations/integrations.service';
import { DuffelFlightProviderService } from './duffel-flight-provider.service';

/**
 * Same caveat as paystack-payment-provider.service.spec.ts: these mock the
 * HTTP layer against Duffel's documented response shapes rather than
 * hitting a real Duffel account (no sandbox key available in this
 * environment). What's verified here is that requests are built correctly
 * and Duffel's documented response shapes are mapped correctly — a real
 * test-mode search and booking should still be run once a key is added at
 * /admin/integrations. See the class-level comment.
 */
describe('DuffelFlightProviderService', () => {
  let service: DuffelFlightProviderService;
  let fetchMock: jest.Mock;
  let integrationsService: { getCredentialConfig: jest.Mock };

  const duffelOffer = {
    id: 'off_00009hthhsUZ8W4LxQgkjo',
    total_amount: '250000.00',
    total_currency: 'NGN',
    expires_at: '2026-09-01T12:00:00Z',
    slices: [
      {
        origin: { iata_code: 'LOS' },
        destination: { iata_code: 'ABV' },
        segments: [
          {
            origin: { iata_code: 'LOS' },
            destination: { iata_code: 'ABV' },
            departing_at: '2026-09-05T08:00:00',
            arriving_at: '2026-09-05T09:30:00',
            marketing_carrier: { name: 'Air Peace', iata_code: 'P4' },
            marketing_carrier_flight_number: '101',
            duration: 'PT1H30M',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    integrationsService = { getCredentialConfig: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuffelFlightProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'DUFFEL_API_KEY' ? 'duffel_test_dummy' : undefined,
            ),
          },
        },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();

    service = module.get(DuffelFlightProviderService);
  });

  describe('searchOffers', () => {
    it('builds the offer_request body and maps the returned offers', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: { id: 'orq_1', offers: [duffelOffer] } }),
      });

      const result = await service.searchOffers({
        tripType: 'ONE_WAY',
        legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-05' }],
        adults: 1,
        cabinClass: 'ECONOMY',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/air/offer_requests?return_offers=true'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer duffel_test_dummy',
            'Duffel-Version': 'v2',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.data.slices).toEqual([
        { origin: 'LOS', destination: 'ABV', departure_date: '2026-09-05' },
      ]);
      expect(body.data.passengers).toEqual([{ type: 'adult' }]);
      expect(body.data.cabin_class).toBe('economy');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'off_00009hthhsUZ8W4LxQgkjo',
        provider: 'DUFFEL',
        currency: 'NGN',
        totalAmount: 250000,
        legs: [
          {
            origin: 'LOS',
            destination: 'ABV',
            departureAt: '2026-09-05T08:00:00',
            arrivalAt: '2026-09-05T09:30:00',
            segments: [
              expect.objectContaining({
                airline: 'Air Peace',
                airlineCode: 'P4',
                flightNumber: 'P4101',
                durationMinutes: 90,
              }),
            ],
          },
        ],
      });
    });

    it('falls back to a separate offers list call when offers are not inlined', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { id: 'orq_1' } }), // no `offers` key
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [duffelOffer] }),
        });

      const result = await service.searchOffers({
        tripType: 'ONE_WAY',
        legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-05' }],
        adults: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain('/air/offers?offer_request_id=orq_1');
      expect(result).toHaveLength(1);
    });

    it('throws ServiceUnavailable when Duffel rejects the request', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ errors: [{ title: 'unauthorized', message: 'Invalid token' }] }),
      });

      await expect(
        service.searchOffers({
          tripType: 'ONE_WAY',
          legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-05' }],
          adults: 1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws when no API key is configured anywhere', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DuffelFlightProviderService,
          { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
          {
            provide: IntegrationsService,
            useValue: { getCredentialConfig: jest.fn().mockResolvedValue(null) },
          },
        ],
      }).compile();
      const unconfigured = module.get(DuffelFlightProviderService);

      await expect(
        unconfigured.searchOffers({
          tripType: 'ONE_WAY',
          legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-05' }],
          adults: 1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('prefers a DB-saved API key over the env var', async () => {
      integrationsService.getCredentialConfig.mockResolvedValue({ apiKey: 'duffel_db_key' });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'orq_1', offers: [duffelOffer] } }),
      });

      await service.searchOffers({
        tripType: 'ONE_WAY',
        legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-05' }],
        adults: 1,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer duffel_db_key' }),
        }),
      );
    });
  });

  describe('getOffer', () => {
    it('returns null on a 404', async () => {
      fetchMock.mockResolvedValue({ status: 404, ok: false, json: () => Promise.resolve({}) });

      const result = await service.getOffer('off_missing');

      expect(result).toBeNull();
    });

    it('maps a found offer', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: duffelOffer }),
      });

      const result = await service.getOffer('off_00009hthhsUZ8W4LxQgkjo');

      expect(result?.id).toBe('off_00009hthhsUZ8W4LxQgkjo');
      expect(result?.totalAmount).toBe(250000);
    });
  });

  describe('createOrder', () => {
    it('books via the balance payment type and returns CONFIRMED', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'ord_00009hthhsUZ8W4LxQgkjo' } }),
      });

      const result = await service.createOrder(
        {
          id: 'off_1',
          provider: 'DUFFEL',
          tripType: 'ONE_WAY',
          legs: [],
          cabinClass: 'ECONOMY',
          currency: 'NGN',
          totalAmount: 250000,
          seatsAvailable: 9,
          expiresAt: '2026-09-01T12:00:00Z',
        },
        [{ type: 'ADULT', firstName: 'Amina', lastName: 'Yusuf' }],
      );

      expect(result).toEqual({ providerOrderId: 'ord_00009hthhsUZ8W4LxQgkjo', status: 'CONFIRMED' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.data.payments).toEqual([
        { type: 'balance', currency: 'NGN', amount: '250000' },
      ]);
      expect(body.data.passengers[0]).toMatchObject({
        type: 'adult',
        given_name: 'Amina',
        family_name: 'Yusuf',
      });
    });

    it('returns FAILED (not a throw) when Duffel rejects the order', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        statusText: 'Unprocessable Entity',
        json: () => Promise.resolve({ errors: [{ title: 'invalid', message: 'Offer expired' }] }),
      });

      const result = await service.createOrder(
        {
          id: 'off_1',
          provider: 'DUFFEL',
          tripType: 'ONE_WAY',
          legs: [],
          cabinClass: 'ECONOMY',
          currency: 'NGN',
          totalAmount: 250000,
          seatsAvailable: 9,
          expiresAt: '2026-09-01T12:00:00Z',
        },
        [{ type: 'ADULT', firstName: 'Amina', lastName: 'Yusuf' }],
      );

      expect(result).toEqual({ providerOrderId: '', status: 'FAILED' });
    });
  });

  describe('cancelOrder', () => {
    it('creates then confirms the cancellation', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { id: 'ore_1' } }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await service.cancelOrder('ord_1');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain('/air/order_cancellations');
      expect(fetchMock.mock.calls[1][0]).toContain(
        '/air/order_cancellations/ore_1/actions/confirm',
      );
    });

    it('throws if the cancellation request itself fails', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ errors: [{ title: 'not_found', message: 'Order not found' }] }),
      });

      await expect(service.cancelOrder('ord_missing')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
