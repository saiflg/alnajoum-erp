import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FlightBookingStatus,
  FlightProviderName,
  TripType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../finance/currency.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { FlightIncentivesService } from './flight-incentives.service';
import { FlightPricingService } from './flight-pricing.service';
import { FlightProviderRoutingService } from './flight-provider-routing.service';
import { FlightsService } from './flights.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import { FlightProviderRouter } from './providers/flight-provider.router';

const baseOffer = {
  id: 'offer-1',
  provider: FlightProviderName.MOCK,
  tripType: TripType.ONE_WAY,
  legs: [
    {
      origin: 'LOS',
      destination: 'ABV',
      departureAt: '2027-01-10T08:00:00.000Z',
      arrivalAt: '2027-01-10T09:10:00.000Z',
      segments: [],
    },
  ],
  cabinClass: 'ECONOMY' as const,
  currency: 'NGN',
  totalAmount: 50_000,
  seatsAvailable: 5,
  expiresAt: '2027-01-10T09:00:00.000Z',
};

describe('FlightsService', () => {
  let service: FlightsService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    familyMember: { findUnique: jest.Mock };
    staff: { findUnique: jest.Mock };
    flightBooking: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    supplierPayable: { create: jest.Mock };
    staffIncentive: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: {
    searchOffers: jest.Mock;
    getOffer: jest.Mock;
    createOrder: jest.Mock;
    cancelOrder: jest.Mock;
    capabilities: jest.Mock;
  };
  let invoicesService: {
    createForFlightBooking: jest.Mock;
    voidIfUnpaid: jest.Mock;
  };
  let notificationsService: { sendBookingConfirmation: jest.Mock };
  let pricingService: { priceOffer: jest.Mock };
  let providerLog: { record: jest.Mock };
  let providerRoutingService: { resolveOrder: jest.Mock };
  let providerRouter: { resolveByName: jest.Mock };
  let auditService: { record: jest.Mock };
  let flightIncentivesService: { createForTicketedBooking: jest.Mock };
  let financePostingService: { postCostOfServiceForBooking: jest.Mock };
  let currencyService: { convertToBase: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      familyMember: { findUnique: jest.fn() },
      staff: { findUnique: jest.fn() },
      flightBooking: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      supplierPayable: { create: jest.fn() },
      staffIncentive: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    provider = {
      searchOffers: jest.fn(),
      getOffer: jest.fn(),
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
      capabilities: jest.fn().mockResolvedValue({ hold: false }),
    };
    invoicesService = {
      createForFlightBooking: jest.fn(),
      voidIfUnpaid: jest.fn(),
    };
    notificationsService = { sendBookingConfirmation: jest.fn() };
    pricingService = {
      // Identity passthrough by default (no markup rule matched) — matches
      // FlightPricingService.applyMarkup's own no-rule behavior. Tests
      // that care about markup override this per-test.
      priceOffer: jest.fn().mockImplementation((providerCost: number) =>
        Promise.resolve({
          customerPrice: providerCost,
          markupAmount: 0,
          rule: null,
        }),
      ),
    };
    providerLog = { record: jest.fn() };
    providerRoutingService = { resolveOrder: jest.fn().mockResolvedValue([]) };
    providerRouter = { resolveByName: jest.fn() };
    auditService = { record: jest.fn() };
    flightIncentivesService = { createForTicketedBooking: jest.fn() };
    financePostingService = { postCostOfServiceForBooking: jest.fn() };
    currencyService = {
      convertToBase: jest
        .fn()
        .mockImplementation((amount: number) =>
          Promise.resolve({ amount, currency: 'NGN' }),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: FlightPricingService, useValue: pricingService },
        {
          provide: FlightProviderRoutingService,
          useValue: providerRoutingService,
        },
        { provide: FlightProviderRouter, useValue: providerRouter },
        { provide: ProviderTransactionLogService, useValue: providerLog },
        { provide: AuditService, useValue: auditService },
        { provide: FlightIncentivesService, useValue: flightIncentivesService },
        { provide: FinancePostingService, useValue: financePostingService },
        { provide: CurrencyService, useValue: currencyService },
      ],
    }).compile();

    service = module.get(FlightsService);
  });

  describe('getOffer', () => {
    it('throws NotFound when the provider has no such offer', async () => {
      provider.getOffer.mockResolvedValue(null);

      await expect(service.getOffer('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('search', () => {
    const leg = {
      origin: 'LOS',
      destination: 'ABV',
      departureDate: '2027-01-10',
    };

    it('accepts a one-way search with exactly 1 leg', async () => {
      provider.searchOffers.mockResolvedValue([baseOffer]);

      await service.search({
        tripType: TripType.ONE_WAY,
        legs: [leg],
        adults: 1,
      });

      expect(provider.searchOffers).toHaveBeenCalled();
    });

    it('rejects a one-way search with more than 1 leg', async () => {
      await expect(
        service.search({
          tripType: TripType.ONE_WAY,
          legs: [leg, leg],
          adults: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(provider.searchOffers).not.toHaveBeenCalled();
    });

    it('rejects a round trip search without exactly 2 legs', async () => {
      await expect(
        service.search({
          tripType: TripType.ROUND_TRIP,
          legs: [leg],
          adults: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a multi-city search with fewer than 2 legs', async () => {
      await expect(
        service.search({
          tripType: TripType.MULTI_CITY,
          legs: [leg],
          adults: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a multi-city search with 3 legs', async () => {
      provider.searchOffers.mockResolvedValue([baseOffer]);

      await service.search({
        tripType: TripType.MULTI_CITY,
        legs: [leg, leg, leg],
        adults: 1,
      });

      expect(provider.searchOffers).toHaveBeenCalled();
    });

    describe('spec #30 — provider routing fallback', () => {
      it('with no routing rule configured, searches only the single active provider', async () => {
        providerRoutingService.resolveOrder.mockResolvedValue([]);
        provider.searchOffers.mockResolvedValue([baseOffer]);

        await service.search({
          tripType: TripType.ONE_WAY,
          legs: [leg],
          adults: 1,
        });

        expect(provider.searchOffers).toHaveBeenCalled();
        expect(providerRouter.resolveByName).not.toHaveBeenCalled();
      });

      it('tries the next configured provider when the first one fails', async () => {
        const secondProvider = {
          searchOffers: jest.fn().mockResolvedValue([baseOffer]),
        };
        providerRoutingService.resolveOrder.mockResolvedValue([
          FlightProviderName.DUFFEL,
          FlightProviderName.TRAVELPORT,
        ]);
        providerRouter.resolveByName.mockImplementation(
          (name: FlightProviderName) =>
            name === FlightProviderName.DUFFEL
              ? {
                  searchOffers: jest
                    .fn()
                    .mockRejectedValue(new Error('Duffel timed out')),
                }
              : secondProvider,
        );

        const result = await service.search({
          tripType: TripType.ONE_WAY,
          legs: [leg],
          adults: 1,
        });

        expect(result).toEqual([baseOffer]);
        expect(secondProvider.searchOffers).toHaveBeenCalled();
      });

      it('throws when every configured provider fails', async () => {
        providerRoutingService.resolveOrder.mockResolvedValue([
          FlightProviderName.DUFFEL,
        ]);
        providerRouter.resolveByName.mockReturnValue({
          searchOffers: jest.fn().mockRejectedValue(new Error('Duffel down')),
        });

        await expect(
          service.search({
            tripType: TripType.ONE_WAY,
            legs: [leg],
            adults: 1,
          }),
        ).rejects.toThrow('Duffel down');
      });
    });
  });

  describe('revalidate', () => {
    it('reports no price change when the provider returns the same amount', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      const result = await service.revalidate('offer-1', 50_000);
      expect(result.priceChanged).toBe(false);
      expect(result.currentAmount).toBe(50_000);
    });

    it('reports a price change and returns the new amount', async () => {
      provider.getOffer.mockResolvedValue({
        ...baseOffer,
        totalAmount: 55_000,
      });
      const result = await service.revalidate('offer-1', 50_000);
      expect(result.priceChanged).toBe(true);
      expect(result.previousAmount).toBe(50_000);
      expect(result.currentAmount).toBe(55_000);
    });
  });

  describe('createBooking', () => {
    it('snapshots the customer themself when no familyMemberId is given', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.customer.findUnique.mockResolvedValue({
        firstName: 'Amina',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: 'A1234567',
        identity: { email: 'amina@example.com' },
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.flightBooking.create.mockResolvedValue({
        id: 'booking-1',
        bookingReference: 'ANJ-ABCD1234',
        origin: 'LOS',
        destination: 'ABV',
        departureAt: new Date('2027-01-10T08:00:00.000Z'),
        totalAmount: 50_000,
        currency: 'NGN',
      });

      await service.createBooking('customer-1', 'offer-1', [
        { type: 'ADULT' as const },
      ]);

      expect(provider.createOrder).toHaveBeenCalledWith(baseOffer, [
        expect.objectContaining({
          firstName: 'Amina',
          lastName: 'Bello',
          passportNumber: 'A1234567',
        }),
      ]);
      expect(prisma.flightBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customerId: 'customer-1' }),
        }),
      );
      expect(invoicesService.createForFlightBooking).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'booking-1' }),
        prisma,
      );
      expect(notificationsService.sendBookingConfirmation).toHaveBeenCalledWith(
        'amina@example.com',
        expect.objectContaining({ bookingReference: 'ANJ-ABCD1234' }),
      );
    });

    it('snapshots a family member owned by the customer', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.familyMember.findUnique.mockResolvedValue({
        customerId: 'customer-1',
        firstName: 'Zara',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: null,
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

      await service.createBooking('customer-1', 'offer-1', [
        { type: 'CHILD' as const, familyMemberId: 'member-1' },
      ]);

      expect(provider.createOrder).toHaveBeenCalledWith(baseOffer, [
        expect.objectContaining({ firstName: 'Zara', lastName: 'Bello' }),
      ]);
    });

    it('rejects a family member that belongs to a different customer', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.familyMember.findUnique.mockResolvedValue({
        customerId: 'someone-else',
      });

      await expect(
        service.createBooking('customer-1', 'offer-1', [
          { type: 'CHILD' as const, familyMemberId: 'member-1' },
        ]),
      ).rejects.toThrow(ForbiddenException);
      expect(provider.createOrder).not.toHaveBeenCalled();
    });

    it('throws NotFound when the referenced family member does not exist', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.familyMember.findUnique.mockResolvedValue(null);

      await expect(
        service.createBooking('customer-1', 'offer-1', [
          { type: 'CHILD' as const, familyMemberId: 'missing' },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the existing booking instead of creating a duplicate for a repeated idempotency key', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-existing',
      });

      const result = await service.createBooking(
        'customer-1',
        'offer-1',
        [{ type: 'ADULT' as const }],
        undefined,
        'idem-key-1',
      );

      expect(result).toEqual({ id: 'booking-existing' });
      expect(provider.createOrder).not.toHaveBeenCalled();
      expect(prisma.flightBooking.create).not.toHaveBeenCalled();
    });

    it('rejects booking when the live price no longer matches what the customer was shown', async () => {
      provider.getOffer.mockResolvedValue({
        ...baseOffer,
        totalAmount: 60_000,
      });

      await expect(
        service.createBooking(
          'customer-1',
          'offer-1',
          [{ type: 'ADULT' as const }],
          undefined,
          undefined,
          50_000, // stale expected price
        ),
      ).rejects.toThrow(ConflictException);
      expect(provider.createOrder).not.toHaveBeenCalled();
    });

    it('throws Conflict when the provider rejects the order', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.customer.findUnique.mockResolvedValue({
        firstName: 'Amina',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: null,
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: '',
        status: 'FAILED',
      });

      await expect(
        service.createBooking('customer-1', 'offer-1', [
          { type: 'ADULT' as const },
        ]),
      ).rejects.toThrow(ConflictException);
      expect(prisma.flightBooking.create).not.toHaveBeenCalled();
    });

    describe('spec #9 — hold reservations', () => {
      beforeEach(() => {
        provider.getOffer.mockResolvedValue(baseOffer);
        prisma.customer.findUnique.mockResolvedValue({
          firstName: 'Amina',
          lastName: 'Bello',
          dateOfBirth: null,
          passportNumber: 'A1234567',
        });
      });

      it('rejects a hold request when the active provider does not support it', async () => {
        provider.capabilities.mockResolvedValue({ hold: false });

        await expect(
          service.createBooking(
            'customer-1',
            'offer-1',
            [{ type: 'ADULT' as const }],
            undefined,
            undefined,
            undefined,
            { hold: true },
          ),
        ).rejects.toThrow(ConflictException);
        expect(provider.createOrder).not.toHaveBeenCalled();
      });

      it('creates an ON_HOLD booking with holdExpiresAt when the provider honors the hold', async () => {
        provider.capabilities.mockResolvedValue({ hold: true });
        provider.createOrder.mockResolvedValue({
          providerOrderId: 'MOCK-1',
          status: 'CONFIRMED',
          holdExpiresAt: '2027-01-05T00:00:00.000Z',
        });
        prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });
        prisma.customer.findUnique.mockResolvedValue({
          identity: { email: 'amina@example.com' },
        });

        await service.createBooking(
          'customer-1',
          'offer-1',
          [{ type: 'ADULT' as const }],
          undefined,
          undefined,
          undefined,
          { hold: true },
        );

        expect(provider.createOrder).toHaveBeenCalledWith(
          baseOffer,
          expect.any(Array),
          { hold: true },
        );
        expect(prisma.flightBooking.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: FlightBookingStatus.ON_HOLD,
              holdExpiresAt: new Date('2027-01-05T00:00:00.000Z'),
            }),
          }),
        );
      });
    });
  });

  describe('getBooking', () => {
    it('throws NotFound when the booking does not exist', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(null);

      await expect(service.getBooking('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the booking belongs to a different customer', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-a',
      });

      await expect(
        service.getBooking('booking-1', 'customer-b'),
      ).rejects.toThrow(ForbiddenException);
    });

    /**
     * Phase 11 spec #65 — FlightBooking has no companyId column of its
     * own; tenant scoping joins through the (required) customer relation
     * instead. A cross-tenant id must come back as NotFound, never a
     * value or a Forbidden that would confirm the id exists.
     */
    it('throws NotFound for a booking belonging to a different tenant', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-a',
        customer: { companyId: 'company-b' },
      });

      await expect(
        service.getBooking('booking-1', undefined, 'company-a'),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns the booking when it belongs to the caller's own tenant", async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-a',
        customer: { companyId: 'company-a' },
      });

      await expect(
        service.getBooking('booking-1', undefined, 'company-a'),
      ).resolves.toEqual(expect.objectContaining({ id: 'booking-1' }));
    });

    it('flags a ticketed manual booking as awaiting approval when no incentive exists yet', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.TICKETED,
        isOfflineEntry: true,
      });
      prisma.staffIncentive.findFirst.mockResolvedValue(null);

      const result = await service.getBooking('booking-1');

      expect(result.awaitingManualApproval).toBe(true);
    });

    it('does not flag a manual booking as awaiting approval once it has been approved', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.TICKETED,
        isOfflineEntry: true,
      });
      prisma.staffIncentive.findFirst.mockResolvedValue({ id: 'incentive-1' });

      const result = await service.getBooking('booking-1');

      expect(result.awaitingManualApproval).toBe(false);
    });

    it('never flags an ordinary (non-offline) booking as awaiting manual approval', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.TICKETED,
        isOfflineEntry: false,
      });

      const result = await service.getBooking('booking-1');

      expect(result.awaitingManualApproval).toBe(false);
      expect(prisma.staffIncentive.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('scopes the query through customer.companyId when a tenant filter is given', async () => {
      prisma.flightBooking.findMany.mockResolvedValue([]);

      await service.listAll({}, 'company-a');

      expect(prisma.flightBooking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customer: { companyId: 'company-a' },
          }),
        }),
      );
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      prisma.flightBooking.findMany.mockResolvedValue([]);

      await service.listAll({});

      const call = prisma.flightBooking.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('customer');
    });
  });

  describe('cancelBooking', () => {
    it('throws Conflict when the booking is already cancelled', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.CANCELLED,
      });

      await expect(
        service.cancelBooking('booking-1', 'customer-1'),
      ).rejects.toThrow(ConflictException);
      expect(provider.cancelOrder).not.toHaveBeenCalled();
    });

    it('rejects a plain cancellation once the booking is ticketed — refund workflow required instead', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.TICKETED,
      });

      await expect(
        service.cancelBooking('booking-1', 'customer-1'),
      ).rejects.toThrow(ConflictException);
      expect(provider.cancelOrder).not.toHaveBeenCalled();
    });

    it('cancels the provider order and updates status', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: FlightBookingStatus.CONFIRMED,
        providerOrderId: 'MOCK-1',
      });
      prisma.flightBooking.update.mockResolvedValue({
        id: 'booking-1',
        status: FlightBookingStatus.CANCELLED,
      });

      const result = await service.cancelBooking('booking-1', 'customer-1');

      expect(provider.cancelOrder).toHaveBeenCalledWith('MOCK-1');
      expect(result.status).toBe(FlightBookingStatus.CANCELLED);
      expect(invoicesService.voidIfUnpaid).toHaveBeenCalledWith('booking-1');
    });
  });

  describe('spec #40 — manual/offline booking', () => {
    const manualDto = {
      customerId: 'customer-1',
      airline: 'Air Peace',
      origin: 'LOS',
      destination: 'ABV',
      departureAt: '2027-01-10T08:00:00.000Z',
      cabinClass: 'ECONOMY' as const,
      passengers: [{ firstName: 'Amina', lastName: 'Bello' }],
      companyCost: 60_000,
      sellingPrice: 80_000,
      status: 'TICKETED' as const,
      offlineReason: 'Customer paid cash at the branch, booked by phone.',
    };

    describe('createManualBooking', () => {
      it('throws NotFound for a missing customer', async () => {
        prisma.customer.findUnique.mockResolvedValue(null);

        await expect(
          service.createManualBooking(manualDto, 'staff-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('creates the booking flagged isOfflineEntry, without touching the provider or the incentive engine', async () => {
        prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });
        prisma.staff.findUnique.mockResolvedValue({
          id: 'staff-1',
          branchId: 'branch-1',
        });
        prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

        await service.createManualBooking(manualDto, 'staff-1');

        expect(prisma.flightBooking.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              isOfflineEntry: true,
              offlineReason: manualDto.offlineReason,
              status: FlightBookingStatus.TICKETED,
              totalAmount: 80_000,
              providerCost: 60_000,
              markupAmount: 20_000,
            }),
          }),
        );
        expect(provider.createOrder).not.toHaveBeenCalled();
        expect(
          flightIncentivesService.createForTicketedBooking,
        ).not.toHaveBeenCalled();
      });

      it('builds a full FlightOffer-shaped itinerary snapshot, not an ad hoc blob', async () => {
        // Regression: every page that renders a booking (e.g. the admin
        // detail page) assumes `itinerary.legs` exists unconditionally,
        // same as a real provider-search booking's snapshot — an
        // itinerary missing `legs` crashes that page for every manual
        // booking, which is spec #40's whole feature.
        prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });
        prisma.staff.findUnique.mockResolvedValue({ id: 'staff-1' });
        prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

        await service.createManualBooking(manualDto, 'staff-1');

        expect(prisma.flightBooking.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              itinerary: expect.objectContaining({
                legs: expect.arrayContaining([
                  expect.objectContaining({
                    origin: 'LOS',
                    destination: 'ABV',
                    segments: expect.arrayContaining([
                      expect.objectContaining({ airline: 'Air Peace' }),
                    ]),
                  }),
                ]),
              }),
            }),
          }),
        );
      });

      it('records a SupplierPayable when a supplier name is given', async () => {
        prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });
        prisma.staff.findUnique.mockResolvedValue({ id: 'staff-1' });
        prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

        await service.createManualBooking(
          { ...manualDto, supplierName: 'Al Rajhi Travel' },
          'staff-1',
        );

        expect(
          financePostingService.postCostOfServiceForBooking,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            supplierName: 'Al Rajhi Travel',
            sourceModule: 'FLIGHT_BOOKING',
            sourceId: 'booking-1',
            amount: 60_000,
          }),
        );
      });
    });

    describe('approveManualBooking', () => {
      it('throws NotFound for a missing booking', async () => {
        prisma.flightBooking.findUnique.mockResolvedValue(null);

        await expect(
          service.approveManualBooking('missing', 'approver-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('rejects a non-manual booking', async () => {
        prisma.flightBooking.findUnique.mockResolvedValue({
          id: 'booking-1',
          isOfflineEntry: false,
          status: FlightBookingStatus.TICKETED,
        });

        await expect(
          service.approveManualBooking('booking-1', 'approver-1'),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects a manual booking that is not yet TICKETED', async () => {
        prisma.flightBooking.findUnique.mockResolvedValue({
          id: 'booking-1',
          isOfflineEntry: true,
          status: FlightBookingStatus.CONFIRMED,
        });

        await expect(
          service.approveManualBooking('booking-1', 'approver-1'),
        ).rejects.toThrow(ConflictException);
      });

      it('creates the incentive only once explicitly approved', async () => {
        prisma.flightBooking.findUnique.mockResolvedValue({
          id: 'booking-1',
          isOfflineEntry: true,
          status: FlightBookingStatus.TICKETED,
          passengers: [],
        });

        await service.approveManualBooking('booking-1', 'approver-1');

        expect(
          flightIncentivesService.createForTicketedBooking,
        ).toHaveBeenCalled();
      });
    });
  });

  /**
   * Before this, search/getOffer/revalidate returned the bare provider
   * price while createBooking silently added the agency markup only at
   * booking time — a customer could see one price during search and be
   * charged a different (higher) one at confirmation. These lock in that
   * every customer-facing read now shows what createBooking will actually
   * charge: the provider's quote converted to NGN, with the same
   * configurable markup rule applied everywhere.
   */
  describe('customer-facing pricing — NGN conversion + configurable markup', () => {
    const markedUpPricing = {
      customerPrice: 150_000,
      markupAmount: 100_000,
      rule: { id: 'rule-1' } as never,
    };

    it('search results carry the configured markup, not the bare provider cost', async () => {
      provider.searchOffers.mockResolvedValue([baseOffer]);
      pricingService.priceOffer.mockResolvedValue(markedUpPricing);

      const [offer] = await service.search({
        tripType: TripType.ONE_WAY,
        legs: [
          { origin: 'LOS', destination: 'ABV', departureDate: '2027-01-10' },
        ],
        adults: 1,
      });

      expect(currencyService.convertToBase).toHaveBeenCalledWith(50_000, 'NGN');
      expect(offer.totalAmount).toBe(150_000);
      expect(offer.currency).toBe('NGN');
    });

    it('converts a non-NGN provider quote to NGN before applying markup', async () => {
      const usdOffer = { ...baseOffer, currency: 'USD', totalAmount: 100 };
      provider.searchOffers.mockResolvedValue([usdOffer]);
      currencyService.convertToBase.mockResolvedValue({
        amount: 150_000,
        currency: 'NGN',
      });
      pricingService.priceOffer.mockResolvedValue({
        customerPrice: 250_000,
        markupAmount: 100_000,
        rule: { id: 'rule-1' } as never,
      });

      const [offer] = await service.search({
        tripType: TripType.ONE_WAY,
        legs: [
          { origin: 'LOS', destination: 'ABV', departureDate: '2027-01-10' },
        ],
        adults: 1,
      });

      expect(currencyService.convertToBase).toHaveBeenCalledWith(100, 'USD');
      expect(pricingService.priceOffer).toHaveBeenCalledWith(
        150_000,
        expect.any(Object),
      );
      expect(offer.totalAmount).toBe(250_000);
      expect(offer.currency).toBe('NGN');
    });

    it('getOfferPreview shows the same marked-up price search does', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      pricingService.priceOffer.mockResolvedValue(markedUpPricing);

      const offer = await service.getOfferPreview('offer-1');

      expect(offer.totalAmount).toBe(150_000);
      expect(offer.currency).toBe('NGN');
    });

    it('revalidate compares against the marked-up price, not the bare provider cost', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      pricingService.priceOffer.mockResolvedValue(markedUpPricing);

      const result = await service.revalidate('offer-1', 150_000);

      expect(result.priceChanged).toBe(false);
      expect(result.currentAmount).toBe(150_000);
    });

    it("createBooking's price-changed guard rejects the stale bare provider price and accepts the previewed one", async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      pricingService.priceOffer.mockResolvedValue(markedUpPricing);

      // A client still holding the old (pre-fix) raw provider price must
      // now be told the price has changed, since 150,000 — not 50,000 —
      // is what search/getOfferPreview actually showed.
      await expect(
        service.createBooking(
          'customer-1',
          'offer-1',
          [{ type: 'ADULT' as const }],
          undefined,
          undefined,
          50_000,
        ),
      ).rejects.toThrow(ConflictException);
      expect(provider.createOrder).not.toHaveBeenCalled();

      prisma.customer.findUnique.mockResolvedValue({
        firstName: 'Amina',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: 'A1234567',
        identity: { email: 'amina@example.com' },
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

      await service.createBooking(
        'customer-1',
        'offer-1',
        [{ type: 'ADULT' as const }],
        undefined,
        undefined,
        150_000,
      );

      expect(provider.createOrder).toHaveBeenCalledWith(
        baseOffer,
        expect.any(Array),
      );
    });

    it('stores the booking currency/providerCost in NGN, converted from the provider quote', async () => {
      const usdOffer = { ...baseOffer, currency: 'USD', totalAmount: 100 };
      provider.getOffer.mockResolvedValue(usdOffer);
      currencyService.convertToBase.mockResolvedValue({
        amount: 150_000,
        currency: 'NGN',
      });
      pricingService.priceOffer.mockResolvedValue({
        customerPrice: 250_000,
        markupAmount: 100_000,
        rule: { id: 'rule-1' } as never,
      });
      prisma.customer.findUnique.mockResolvedValue({
        firstName: 'Amina',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: 'A1234567',
        identity: { email: 'amina@example.com' },
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

      await service.createBooking('customer-1', 'offer-1', [
        { type: 'ADULT' as const },
      ]);

      expect(prisma.flightBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: 'NGN',
            totalAmount: 250_000,
            providerCost: 150_000,
            markupAmount: 100_000,
          }),
        }),
      );
      // provider.createOrder must still receive the untouched, raw
      // provider offer (its own currency/amount) — never the priced one —
      // since that's what actually places the order with the provider.
      expect(provider.createOrder).toHaveBeenCalledWith(
        usdOffer,
        expect.any(Array),
      );
    });
  });
});
