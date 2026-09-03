import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VisaApplicationStatus, VisaType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { VisaService } from './visa.service';

describe('VisaService', () => {
  let service: VisaService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    familyMember: { findUnique: jest.Mock };
    visaApplication: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let invoicesService: {
    createForVisaApplication: jest.Mock;
    voidVisaApplicationIfUnpaid: jest.Mock;
  };
  let notificationsService: { sendVisaApplicationStatusUpdate: jest.Mock };

  const customer = {
    id: 'customer-1',
    firstName: 'Amina',
    lastName: 'Yusuf',
    passportNumber: 'A1234567',
  };

  const applicationRow = {
    id: 'app-1',
    applicationReference: 'VISA-ABC123',
    customerId: 'customer-1',
    familyMemberId: null,
    destinationCountry: 'Saudi Arabia',
    visaType: VisaType.PILGRIMAGE,
    status: VisaApplicationStatus.SUBMITTED,
    staffNote: null,
    currency: 'NGN',
    totalAmount: 20_000,
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      familyMember: { findUnique: jest.fn() },
      visaApplication: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    invoicesService = {
      createForVisaApplication: jest.fn(),
      voidVisaApplicationIfUnpaid: jest.fn(),
    };
    notificationsService = { sendVisaApplicationStatusUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(VisaService);

    prisma.visaApplication.findUnique.mockResolvedValue({
      ...applicationRow,
      customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
    });
  });

  describe('submit', () => {
    it('resolves the applicant, applies the fee schedule, creates an invoice, and notifies', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.visaApplication.create.mockResolvedValue(applicationRow);

      await service.submit('customer-1', {
        destinationCountry: 'Saudi Arabia',
        visaType: VisaType.PILGRIMAGE,
      });

      expect(prisma.visaApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'customer-1',
            familyMemberId: null,
            visaType: VisaType.PILGRIMAGE,
            totalAmount: 20_000, // VISA_PROCESSING_FEES.PILGRIMAGE
            applicantFirstName: 'Amina',
            applicantLastName: 'Yusuf',
          }),
        }),
      );
      expect(invoicesService.createForVisaApplication).toHaveBeenCalled();
      expect(notificationsService.sendVisaApplicationStatusUpdate).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ applicationReference: 'VISA-ABC123' }),
      );
    });

    it('resolves a family member applicant and rejects one belonging to a different customer', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({
        id: 'fm-1',
        customerId: 'someone-else',
        firstName: 'Bilal',
        lastName: 'Yusuf',
        passportNumber: null,
      });

      await expect(
        service.submit('customer-1', {
          destinationCountry: 'UK',
          visaType: VisaType.TOURIST,
          familyMemberId: 'fm-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for a missing family member', async () => {
      prisma.familyMember.findUnique.mockResolvedValue(null);

      await expect(
        service.submit('customer-1', {
          destinationCountry: 'UK',
          visaType: VisaType.TOURIST,
          familyMemberId: 'missing',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getApplication', () => {
    it('throws Forbidden when the application belongs to a different customer', async () => {
      await expect(service.getApplication('app-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFound when the application does not exist', async () => {
      prisma.visaApplication.findUnique.mockResolvedValueOnce(null);

      await expect(service.getApplication('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status, notifies, and voids the invoice when cancelled', async () => {
      await service.updateStatus('app-1', VisaApplicationStatus.CANCELLED, 'no longer needed');

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.CANCELLED, staffNote: 'no longer needed' },
      });
      expect(invoicesService.voidVisaApplicationIfUnpaid).toHaveBeenCalledWith('app-1');
      expect(notificationsService.sendVisaApplicationStatusUpdate).toHaveBeenCalled();
    });

    it('does not void an invoice for a non-terminal status transition', async () => {
      await service.updateStatus('app-1', VisaApplicationStatus.IN_REVIEW);

      expect(invoicesService.voidVisaApplicationIfUnpaid).not.toHaveBeenCalled();
    });

    it('rejects updating an application already in a terminal state', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.ISSUED,
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });

      await expect(
        service.updateStatus('app-1', VisaApplicationStatus.APPROVED),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('cancels a non-terminal application and voids its unpaid invoice', async () => {
      await service.cancel('app-1', 'customer-1');

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.CANCELLED },
      });
      expect(invoicesService.voidVisaApplicationIfUnpaid).toHaveBeenCalledWith('app-1');
    });

    it('rejects cancelling an already-terminal application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.REJECTED,
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });

      await expect(service.cancel('app-1')).rejects.toThrow(ConflictException);
    });
  });
});
