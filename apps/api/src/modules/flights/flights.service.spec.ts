import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightBookingStatus, FlightProviderName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightsService } from './flights.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

const baseOffer = {
  id: 'offer-1',
  provider: FlightProviderName.MOCK,
  origin: 'LOS',
  destination: 'ABV',
  departureAt: '2027-01-10T08:00:00.000Z',
  arrivalAt: '2027-01-10T09:10:00.000Z',
  cabinClass: 'ECONOMY' as const,
  currency: 'NGN',
  totalAmount: 50_000,
  seatsAvailable: 5,
  outboundSegments: [],
  expiresAt: '2027-01-10T09:00:00.000Z',
};

describe('FlightsService', () => {
  let service: FlightsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let provider: {
    searchOffers: jest.Mock;
    getOffer: jest.Mock;
    createOrder: jest.Mock;
    cancelOrder: jest.Mock;
  };

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
    };
    provider = {
      searchOffers: jest.fn(),
      getOffer: jest.fn(),
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
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

  describe('createBooking', () => {
    it('snapshots the customer themself when no familyMemberId is given', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      prisma.customer.findUnique.mockResolvedValue({
        firstName: 'Amina',
        lastName: 'Bello',
        dateOfBirth: null,
        passportNumber: 'A1234567',
      });
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-1' });

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
    });
  });
});
