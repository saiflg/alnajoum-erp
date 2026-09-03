import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CorporateBookingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InvoicesService } from '../payments/invoices.service';
import { CorporateTravelService } from './corporate-travel.service';

describe('CorporateTravelService', () => {
  let service: CorporateTravelService;
  let prisma: {
    corporateAccount: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    corporateTraveler: { create: jest.Mock; findMany: jest.Mock };
    corporateBooking: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let invoicesService: {
    createForCorporateBooking: jest.Mock;
    voidCorporateBookingIfUnpaid: jest.Mock;
  };

  const account = {
    id: 'acct-1',
    name: 'Zenith Logistics Ltd',
    managedBranch: null,
    travelers: [],
  };

  const travelers = [
    { id: 'trav-1', corporateAccountId: 'acct-1', firstName: 'Musa', lastName: 'Bello' },
    { id: 'trav-2', corporateAccountId: 'acct-1', firstName: 'Hauwa', lastName: 'Sani' },
  ];

  beforeEach(async () => {
    prisma = {
      corporateAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      corporateTraveler: { create: jest.fn(), findMany: jest.fn() },
      corporateBooking: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    invoicesService = {
      createForCorporateBooking: jest.fn(),
      voidCorporateBookingIfUnpaid: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorporateTravelService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
      ],
    }).compile();

    service = module.get(CorporateTravelService);
    prisma.corporateAccount.findUnique.mockResolvedValue(account);
  });

  describe('getAccount', () => {
    it('throws NotFound for a missing account', async () => {
      prisma.corporateAccount.findUnique.mockResolvedValueOnce(null);

      await expect(service.getAccount('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addTraveler', () => {
    it('validates the account exists before adding a traveler', async () => {
      prisma.corporateTraveler.create.mockResolvedValue(travelers[0]);

      await service.addTraveler('acct-1', { firstName: 'Musa', lastName: 'Bello' });

      expect(prisma.corporateAccount.findUnique).toHaveBeenCalled();
      expect(prisma.corporateTraveler.create).toHaveBeenCalledWith({
        data: { firstName: 'Musa', lastName: 'Bello', corporateAccountId: 'acct-1' },
      });
    });
  });

  describe('createBooking', () => {
    it('creates a booking with one line item per traveler and a consolidated invoice', async () => {
      prisma.corporateTraveler.findMany.mockResolvedValue(travelers);
      prisma.corporateBooking.create.mockResolvedValue({
        id: 'booking-1',
        bookingReference: 'CORP-ABC123',
        corporateAccountId: 'acct-1',
        totalAmount: 150_000,
        currency: 'NGN',
        travelers: [
          { travelerId: 'trav-1', amount: 90_000, description: 'Flight LOS-ABV', traveler: travelers[0] },
          { travelerId: 'trav-2', amount: 60_000, description: 'Flight LOS-ABV', traveler: travelers[1] },
        ],
      });

      await service.createBooking(
        'acct-1',
        {
          description: 'Lagos-Abuja trip',
          travelers: [
            { travelerId: 'trav-1', description: 'Flight LOS-ABV', amount: 90_000 },
            { travelerId: 'trav-2', description: 'Flight LOS-ABV', amount: 60_000 },
          ],
        },
        'staff-1',
      );

      expect(prisma.corporateBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            corporateAccountId: 'acct-1',
            bookedByStaffId: 'staff-1',
            status: CorporateBookingStatus.CONFIRMED,
            totalAmount: 150_000,
          }),
        }),
      );
      expect(invoicesService.createForCorporateBooking).toHaveBeenCalled();
    });

    it('throws NotFound when a traveler does not belong to this account', async () => {
      prisma.corporateTraveler.findMany.mockResolvedValue([travelers[0]]); // only one of two resolves

      await expect(
        service.createBooking(
          'acct-1',
          {
            description: 'Trip',
            travelers: [
              { travelerId: 'trav-1', description: 'Flight', amount: 90_000 },
              { travelerId: 'trav-2', description: 'Flight', amount: 60_000 },
            ],
          },
          'staff-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.corporateBooking.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelBooking', () => {
    it('cancels the booking and voids its unpaid invoice', async () => {
      prisma.corporateBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: CorporateBookingStatus.CONFIRMED,
      });
      prisma.corporateBooking.update.mockResolvedValue({
        id: 'booking-1',
        status: CorporateBookingStatus.CANCELLED,
      });

      await service.cancelBooking('booking-1');

      expect(prisma.corporateBooking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: CorporateBookingStatus.CANCELLED },
      });
      expect(invoicesService.voidCorporateBookingIfUnpaid).toHaveBeenCalledWith('booking-1');
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      prisma.corporateBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: CorporateBookingStatus.CANCELLED,
      });

      await expect(service.cancelBooking('booking-1')).rejects.toThrow(ConflictException);
    });
  });
});
