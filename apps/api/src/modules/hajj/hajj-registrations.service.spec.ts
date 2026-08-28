import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PackageStatus, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { HajjRegistrationsService } from './hajj-registrations.service';

describe('HajjRegistrationsService', () => {
  let service: HajjRegistrationsService;
  let prisma: Record<string, any>;
  let invoicesService: { createForHajjRegistration: jest.Mock };
  let notificationsService: { sendPilgrimageRegistrationConfirmation: jest.Mock };

  const publishedPackage = {
    id: 'pkg-1',
    name: 'Standard Hajj 2027',
    status: PackageStatus.PUBLISHED,
    price: 6_000_000,
    currency: 'NGN',
    seatsAvailable: 3,
  };

  beforeEach(async () => {
    prisma = {
      hajjPackage: { findUnique: jest.fn(), update: jest.fn() },
      hajjRegistration: { create: jest.fn() },
      familyMember: { findUnique: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    invoicesService = { createForHajjRegistration: jest.fn() };
    notificationsService = { sendPilgrimageRegistrationConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HajjRegistrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(HajjRegistrationsService);
  });

  it('throws NotFound when the package does not exist', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue(null);

    await expect(
      service.register('customer-1', 'pkg-missing', [{}]),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects registering against a non-PUBLISHED package', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue({
      ...publishedPackage,
      status: PackageStatus.DRAFT,
    });

    await expect(
      service.register('customer-1', 'pkg-1', [{}]),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects registering more pilgrims than seats remain', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue({
      ...publishedPackage,
      seatsAvailable: 1,
    });

    await expect(
      service.register('customer-1', 'pkg-1', [{}, {}]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a family member pilgrim that belongs to a different customer', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue(publishedPackage);
    prisma.familyMember.findUnique.mockResolvedValue({
      id: 'fm-1',
      customerId: 'someone-else',
    });

    await expect(
      service.register('customer-1', 'pkg-1', [{ familyMemberId: 'fm-1' }]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('registers, decrements seats, generates an invoice, and totals the price per pilgrim', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue(publishedPackage);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'customer-1',
      firstName: 'Amina',
      lastName: 'Bello',
      passportNumber: 'A1234567',
    });
    prisma.familyMember.findUnique.mockResolvedValue({
      id: 'fm-1',
      customerId: 'customer-1',
      firstName: 'Musa',
      lastName: 'Bello',
      passportNumber: 'A7654321',
    });
    prisma.hajjRegistration.create.mockResolvedValue({
      id: 'reg-1',
      registrationNumber: 'HAJJ-ABC123',
      totalAmount: 12_000_000,
      currency: 'NGN',
      package: publishedPackage,
      pilgrims: [
        { firstName: 'Amina', lastName: 'Bello' },
        { firstName: 'Musa', lastName: 'Bello' },
      ],
    });
    prisma.customer.findUnique
      .mockResolvedValueOnce({
        id: 'customer-1',
        firstName: 'Amina',
        lastName: 'Bello',
        passportNumber: 'A1234567',
      })
      .mockResolvedValueOnce({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });

    const result = await service.register('customer-1', 'pkg-1', [
      {},
      { familyMemberId: 'fm-1' },
    ]);

    expect(prisma.hajjRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          packageId: 'pkg-1',
          customerId: 'customer-1',
          status: RegistrationStatus.CONFIRMED,
          totalAmount: 12_000_000, // 6,000,000 x 2 pilgrims
        }),
      }),
    );
    expect(prisma.hajjPackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ seatsAvailable: 1 }), // 3 - 2
      }),
    );
    expect(invoicesService.createForHajjRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reg-1' }),
      [
        { firstName: 'Amina', lastName: 'Bello' },
        { firstName: 'Musa', lastName: 'Bello' },
      ],
      expect.anything(),
    );
    expect(notificationsService.sendPilgrimageRegistrationConfirmation).toHaveBeenCalledWith(
      'amina@example.com',
      expect.objectContaining({ kind: 'Hajj', pilgrimCount: 2 }),
    );
    expect(result.registrationNumber).toBe('HAJJ-ABC123');
  });

  it('flips the package to FULLY_BOOKED when the last seats are taken', async () => {
    prisma.hajjPackage.findUnique.mockResolvedValue({
      ...publishedPackage,
      seatsAvailable: 1,
    });
    prisma.customer.findUnique
      .mockResolvedValueOnce({
        id: 'customer-1',
        firstName: 'Amina',
        lastName: 'Bello',
        passportNumber: 'A1234567',
      })
      .mockResolvedValueOnce({ id: 'customer-1', identity: { email: 'a@example.com' } });
    prisma.hajjRegistration.create.mockResolvedValue({
      id: 'reg-1',
      registrationNumber: 'HAJJ-ABC123',
      totalAmount: 6_000_000,
      currency: 'NGN',
      package: publishedPackage,
      pilgrims: [],
    });

    await service.register('customer-1', 'pkg-1', [{}]);

    expect(prisma.hajjPackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seatsAvailable: 0,
          status: PackageStatus.FULLY_BOOKED,
        }),
      }),
    );
  });

  describe('getRegistration', () => {
    it('throws Forbidden when the registration belongs to a different customer', async () => {
      prisma.hajjRegistration = { findUnique: jest.fn() } as never;
      (prisma as any).hajjRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        customerId: 'customer-a',
      });

      await expect(
        service.getRegistration('reg-1', 'customer-b'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
