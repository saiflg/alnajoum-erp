import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VehicleRentalProviderName, VehicleRentalStatus, VehicleType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { VEHICLE_RENTAL_PROVIDER } from './providers/vehicle-rental-provider.port';
import { VehicleRentalsService } from './vehicle-rentals.service';

const baseOffer = {
  id: 'offer-1',
  provider: VehicleRentalProviderName.MOCK,
  vehicleType: VehicleType.CAR,
  vehicleName: 'Toyota Camry',
  pickupCity: 'Lagos',
  pickupAt: '2027-01-10T08:00:00.000Z',
  dropoffAt: '2027-01-12T08:00:00.000Z',
  withDriver: true,
  seats: 4,
  currency: 'NGN',
  totalAmount: 90_000,
  features: ['Air Conditioning'],
  expiresAt: '2027-01-09T00:00:00.000Z',
};

describe('VehicleRentalsService', () => {
  let service: VehicleRentalsService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    vehicleRental: {
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
    createForVehicleRental: jest.Mock;
    voidVehicleRentalIfUnpaid: jest.Mock;
  };
  let notificationsService: { sendBookingConfirmation: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      vehicleRental: {
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
      createForVehicleRental: jest.fn(),
      voidVehicleRentalIfUnpaid: jest.fn(),
    };
    notificationsService = { sendBookingConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleRentalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: VEHICLE_RENTAL_PROVIDER, useValue: provider },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(VehicleRentalsService);
  });

  describe('search', () => {
    it('rejects a drop-off time that is not after pickup', async () => {
      await expect(
        service.search({
          vehicleType: VehicleType.CAR,
          pickupCity: 'Lagos',
          pickupAt: '2027-01-12T08:00:00.000Z',
          dropoffAt: '2027-01-10T08:00:00.000Z',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('delegates to the provider for a valid time range', async () => {
      provider.searchOffers.mockResolvedValue([baseOffer]);

      const result = await service.search({
        vehicleType: VehicleType.CAR,
        pickupCity: 'Lagos',
        pickupAt: '2027-01-10T08:00:00.000Z',
        dropoffAt: '2027-01-12T08:00:00.000Z',
      });

      expect(provider.searchOffers).toHaveBeenCalledWith({
        vehicleType: VehicleType.CAR,
        pickupCity: 'Lagos',
        pickupAt: '2027-01-10T08:00:00.000Z',
        dropoffAt: '2027-01-12T08:00:00.000Z',
        withDriver: undefined,
      });
      expect(result).toEqual([baseOffer]);
    });
  });

  describe('createBooking', () => {
    it('creates a booking, an invoice, and sends a confirmation', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      provider.createOrder.mockResolvedValue({
        providerOrderId: 'MOCK-1',
        status: 'CONFIRMED',
      });
      prisma.vehicleRental.create.mockResolvedValue({
        id: 'rental-1',
        bookingReference: 'VEH-ABC123',
        vehicleName: baseOffer.vehicleName,
        pickupCity: baseOffer.pickupCity,
        pickupAt: new Date(baseOffer.pickupAt),
        totalAmount: baseOffer.totalAmount,
        currency: baseOffer.currency,
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });

      await service.createBooking('customer-1', 'offer-1');

      expect(prisma.vehicleRental.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: VehicleRentalStatus.CONFIRMED,
            vehicleName: 'Toyota Camry',
            withDriver: true,
          }),
        }),
      );
      expect(invoicesService.createForVehicleRental).toHaveBeenCalled();
      expect(notificationsService.sendBookingConfirmation).toHaveBeenCalledWith(
        'amina@example.com',
        expect.objectContaining({ bookingReference: 'VEH-ABC123' }),
      );
    });

    it('throws Conflict when the provider rejects the order (offer expired)', async () => {
      provider.getOffer.mockResolvedValue(baseOffer);
      provider.createOrder.mockResolvedValue({ providerOrderId: '', status: 'FAILED' });

      await expect(service.createBooking('customer-1', 'offer-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.vehicleRental.create).not.toHaveBeenCalled();
    });
  });

  describe('getBooking', () => {
    it('throws Forbidden when the booking belongs to a different customer', async () => {
      prisma.vehicleRental.findUnique.mockResolvedValue({
        id: 'rental-1',
        customerId: 'customer-a',
      });

      await expect(service.getBooking('rental-1', 'customer-b')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFound when the booking does not exist', async () => {
      prisma.vehicleRental.findUnique.mockResolvedValue(null);

      await expect(service.getBooking('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelBooking', () => {
    it('cancels the provider order, updates status, and voids the unpaid invoice', async () => {
      prisma.vehicleRental.findUnique.mockResolvedValue({
        id: 'rental-1',
        customerId: 'customer-1',
        status: VehicleRentalStatus.CONFIRMED,
        providerOrderId: 'MOCK-1',
      });
      prisma.vehicleRental.update.mockResolvedValue({
        id: 'rental-1',
        status: VehicleRentalStatus.CANCELLED,
      });

      await service.cancelBooking('rental-1');

      expect(provider.cancelOrder).toHaveBeenCalledWith('MOCK-1');
      expect(prisma.vehicleRental.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VehicleRentalStatus.CANCELLED } }),
      );
      expect(invoicesService.voidVehicleRentalIfUnpaid).toHaveBeenCalledWith('rental-1');
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      prisma.vehicleRental.findUnique.mockResolvedValue({
        id: 'rental-1',
        customerId: 'customer-1',
        status: VehicleRentalStatus.CANCELLED,
      });

      await expect(service.cancelBooking('rental-1')).rejects.toThrow(ConflictException);
    });
  });
});
