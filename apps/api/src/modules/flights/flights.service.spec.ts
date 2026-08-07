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
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { FlightsService } from './flights.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

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
    flightBooking: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let provider: {
    searchOffers: jest.Mock;
    getOffer: jest.Mock;
    createOrder: jest.Mock;
    cancelOrder: jest.Mock;
  };
  let invoicesService: {
    createForFlightBooking: jest.Mock;
    voidIfUnpaid: jest.Mock;
  };
  let notificationsService: { sendBookingConfirmation: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      familyMember: { findUnique: jest.fn() },
      flightBooking: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    provider = {
      searchOffers: jest.fn(),
      getOffer: jest.fn(),
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
    };
    invoicesService = {
      createForFlightBooking: jest.fn(),
      voidIfUnpaid: jest.fn(),
    };
    notificationsService = { sendBookingConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
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
});
