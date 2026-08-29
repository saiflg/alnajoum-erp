import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HotelBookingStatus, HotelProviderName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { HotelsService } from './hotels.service';
import { HOTEL_PROVIDER } from './providers/hotel-provider.port';

const baseOffer = {
  id: 'offer-1',
  provider: HotelProviderName.MOCK,
  hotelName: 'Grand Cavalli Hotel',
  city: 'Lagos',
  country: 'Nigeria',
  starRating: 4,
  roomType: 'Deluxe Room',
  checkInDate: '2027-01-10',
  checkOutDate: '2027-01-12',
  rooms: 1,
  guests: 2,
  currency: 'NGN',
  totalAmount: 150_000,
  amenities: ['Free WiFi'],
  expiresAt: '2027-01-09T00:00:00.000Z',
};

describe('HotelsService', () => {
  let service: HotelsService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    hotelBooking: {
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
    createForHotelBooking: jest.Mock;
    voidHotelBookingIfUnpaid: jest.Mock;
  };
  let notificationsService: { sendBookingConfirmation: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      hotelBooking: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    provider = {
      searchOffers: jest.fn(),
      getOffer: jest.fn(),
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
    };
    invoicesService = {
      createForHotelBooking: jest.fn(),
      voidHotelBookingIfUnpaid: jest.fn(),
    };
    notificationsService = { sendBookingConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelsService,
        { provide: PrismaService, useValue: prisma },
        { provide: HOTEL_PROVIDER, useValue: provider },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(HotelsService);
  });

  describe('search', () => {
    it('rejects a check-out date that is not after check-in', async () => {
      await expect(
        service.search({
          city: 'Lagos',
          checkInDate: '2027-01-12',
          checkOutDate: '2027-01-10',
          rooms: 1,
          guests: 2,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('delegates to the provider for a valid date range', async () => {
      provider.searchOffers.mockResolvedValue([baseOffer]);

      const result = await service.search({
        city: 'Lagos',
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-12',
        rooms: 1,
        guests: 2,
      });

      expect(provider.searchOffers).toHaveBeenCalledWith({
        city: 'Lagos',
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-12',
        rooms: 1,
        guests: 2,
      });
      expect(result).toEqual([baseOffer]);
    });
  });

  describe('getOffer', () => {
    it('throws NotFound when the provider has no such offer', async () => {
      provider.getOffer.mockResolvedValue(null);

      await expect(service.getOffer('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createBooking', () => {
    it('creates a booking, an invoice, and sends a confirmation', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.hotelBooking.create.mockResolvedValue({
        id: 'booking-1',
        bookingReference: 'HTL-ABC123',
        hotelName: baseOffer.hotelName,
        city: baseOffer.city,
        checkInDate: new Date(baseOffer.checkInDate),
        totalAmount: baseOffer.totalAmount,
        currency: baseOffer.currency,
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });

      await service.createBooking('customer-1', 'offer-1');

      expect(prisma.hotelBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: HotelBookingStatus.CONFIRMED,
            hotelName: 'Grand Cavalli Hotel',
            city: 'Lagos',
            rooms: 1,
            guests: 2,
          }),
        }),
      );
      expect(invoicesService.createForHotelBooking).toHaveBeenCalled();
      expect(notificationsService.sendBookingConfirmation).toHaveBeenCalledWith(
        'amina@example.com',
        expect.objectContaining({ bookingReference: 'HTL-ABC123' }),
      );
    });

    it('throws Conflict when the provider rejects the order (offer expired)', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      provider.createOrder.mockResolvedValue({ providerOrderId: '', status: 'FAILED' });

      await expect(service.createBooking('customer-1', 'offer-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.hotelBooking.create).not.toHaveBeenCalled();
    });
  });

  describe('getBooking', () => {
    it('throws Forbidden when the booking belongs to a different customer', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-a',
      });

      await expect(service.getBooking('booking-1', 'customer-b')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFound when the booking does not exist', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue(null);

      await expect(service.getBooking('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelBooking', () => {
    it('cancels the provider order, updates status, and voids the unpaid invoice', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: HotelBookingStatus.CONFIRMED,
        providerOrderId: 'MOCK-1',
      });
      prisma.hotelBooking.update.mockResolvedValue({
        id: 'booking-1',
        status: HotelBookingStatus.CANCELLED,
      });

      await service.cancelBooking('booking-1');

      expect(provider.cancelOrder).toHaveBeenCalledWith('MOCK-1');
      expect(prisma.hotelBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: HotelBookingStatus.CANCELLED } }),
      );
      expect(invoicesService.voidHotelBookingIfUnpaid).toHaveBeenCalledWith('booking-1');
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        customerId: 'customer-1',
        status: HotelBookingStatus.CANCELLED,
      });

      await expect(service.cancelBooking('booking-1')).rejects.toThrow(ConflictException);
    });
  });
});
