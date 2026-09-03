import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  VisaApplicationStatus,
  VisaServiceStatus,
  VisaType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { VisaIncentivesService } from './visa-incentives.service';
import { VisaService } from './visa.service';

describe('VisaService', () => {
  let service: VisaService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    familyMember: { findUnique: jest.Mock };
    visaService: { findUnique: jest.Mock };
    visaApplication: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    visaApplicationNote: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let invoicesService: {
    createForVisaApplication: jest.Mock;
    voidVisaApplicationIfUnpaid: jest.Mock;
  };
  let notificationsService: {
    sendVisaApplicationStatusUpdate: jest.Mock;
    sendGuarantorRequired: jest.Mock;
  };
  let auditService: { record: jest.Mock };
  let visaIncentivesService: { createForCompletedApplication: jest.Mock };

  const customer = {
    id: 'customer-1',
    firstName: 'Amina',
    lastName: 'Yusuf',
    passportNumber: 'A1234567',
    identity: { id: 'identity-1', email: 'amina@example.com' },
  };

  const applicationRow = {
    id: 'app-1',
    applicationReference: 'VISA-2026-000001',
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
      visaService: { findUnique: jest.fn() },
      visaApplication: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      visaApplicationNote: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    invoicesService = {
      createForVisaApplication: jest.fn(),
      voidVisaApplicationIfUnpaid: jest.fn(),
    };
    notificationsService = {
      sendVisaApplicationStatusUpdate: jest.fn(),
      sendGuarantorRequired: jest.fn(),
    };
    auditService = { record: jest.fn() };
    visaIncentivesService = { createForCompletedApplication: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
        { provide: VisaIncentivesService, useValue: visaIncentivesService },
      ],
    }).compile();

    service = module.get(VisaService);

    prisma.visaApplication.findUnique.mockResolvedValue({
      ...applicationRow,
      customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
    });
  });

  describe('submit — Phase 2 flat-fee flow (no visaServiceId)', () => {
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
            guarantorRequired: false,
          }),
        }),
      );
      expect(invoicesService.createForVisaApplication).toHaveBeenCalled();
      expect(notificationsService.sendVisaApplicationStatusUpdate).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ applicationReference: 'VISA-2026-000001' }),
      );
    });

    it('generates a sequential VISA-<year>-NNNNNN reference', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.visaApplication.count.mockResolvedValue(4);
      prisma.visaApplication.create.mockResolvedValue(applicationRow);

      await service.submit('customer-1', {
        destinationCountry: 'UK',
        visaType: VisaType.TOURIST,
      });

      const year = new Date().getFullYear();
      expect(prisma.visaApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationReference: `VISA-${year}-000005`,
          }),
        }),
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

  describe('submit — Phase 3 catalog-linked flow (visaServiceId)', () => {
    const visaServiceRow = {
      id: 'vs-1',
      status: VisaServiceStatus.ACTIVE,
      isAvailable: true,
      currency: 'NGN',
      companyCost: 600_000,
      sellingPrice: 800_000,
      processingFee: 5_000,
      otherFees: 0,
      requiresGuarantor: true,
    };

    beforeEach(() => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.visaService.findUnique.mockResolvedValue(visaServiceRow);
    });

    it('prices from the catalog entry, snapshots cost/selling price, and starts AWAITING_GUARANTOR when required', async () => {
      prisma.visaApplication.create.mockResolvedValue({
        ...applicationRow,
        id: 'app-2',
        status: VisaApplicationStatus.SUBMITTED,
      });

      const result = await service.submit('customer-1', {
        destinationCountry: 'Saudi Arabia',
        visaType: VisaType.PILGRIMAGE,
        visaServiceId: 'vs-1',
      });

      expect(prisma.visaApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 805_000, // sellingPrice + processingFee + otherFees
            companyCostSnapshot: 600_000,
            sellingPriceSnapshot: 800_000,
            guarantorRequired: true,
          }),
        }),
      );
      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-2' },
        data: { status: VisaApplicationStatus.AWAITING_GUARANTOR },
      });
      expect(notificationsService.sendGuarantorRequired).toHaveBeenCalled();
      expect(result.status).toBe(VisaApplicationStatus.AWAITING_GUARANTOR);
    });

    it('skips the guarantor step and starts PAYMENT_PENDING when the service has requiresGuarantor=false', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        ...visaServiceRow,
        requiresGuarantor: false,
      });
      prisma.visaApplication.create.mockResolvedValue({ ...applicationRow, id: 'app-3' });

      const result = await service.submit('customer-1', {
        destinationCountry: 'Saudi Arabia',
        visaType: VisaType.PILGRIMAGE,
        visaServiceId: 'vs-1',
      });

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-3' },
        data: { status: VisaApplicationStatus.PAYMENT_PENDING },
      });
      expect(notificationsService.sendGuarantorRequired).not.toHaveBeenCalled();
      expect(result.status).toBe(VisaApplicationStatus.PAYMENT_PENDING);
    });

    it('throws NotFound for a missing visa service', async () => {
      prisma.visaService.findUnique.mockResolvedValue(null);

      await expect(
        service.submit('customer-1', {
          destinationCountry: 'X',
          visaType: VisaType.OTHER,
          visaServiceId: 'missing',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a DRAFT (not yet ACTIVE) visa service', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        ...visaServiceRow,
        status: VisaServiceStatus.DRAFT,
      });

      await expect(
        service.submit('customer-1', {
          destinationCountry: 'X',
          visaType: VisaType.OTHER,
          visaServiceId: 'vs-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('honors a staff-set guarantorExempt override and skips straight to PAYMENT_PENDING', async () => {
      prisma.visaApplication.create.mockResolvedValue({ ...applicationRow, id: 'app-4' });

      await service.submit(
        'customer-1',
        { destinationCountry: 'Saudi Arabia', visaType: VisaType.PILGRIMAGE, visaServiceId: 'vs-1' },
        'staff-1',
        { guarantorExempt: true, guarantorExemptReason: 'Applicant is a known VIP client' },
      );

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-4' },
        data: { status: VisaApplicationStatus.PAYMENT_PENDING },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_application.guarantor_exempted' }),
      );
    });

    it('rejects a guarantor exemption with no reason', async () => {
      await expect(
        service.submit(
          'customer-1',
          { destinationCountry: 'X', visaType: VisaType.OTHER, visaServiceId: 'vs-1' },
          'staff-1',
          { guarantorExempt: true },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an offline entry with no reason', async () => {
      await expect(
        service.submit(
          'customer-1',
          { destinationCountry: 'X', visaType: VisaType.OTHER },
          'staff-1',
          { isOfflineEntry: true },
        ),
      ).rejects.toThrow(BadRequestException);
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

    it('creates an incentive when the application is marked COMPLETED', async () => {
      prisma.visaApplication.findUniqueOrThrow.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.COMPLETED,
      });

      await service.updateStatus('app-1', VisaApplicationStatus.COMPLETED);

      expect(visaIncentivesService.createForCompletedApplication).toHaveBeenCalled();
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

  describe('markPaymentVerified', () => {
    it('moves PAYMENT_PENDING to PAYMENT_VERIFIED once the invoice is fully paid', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.PAYMENT_PENDING,
        invoice: { status: InvoiceStatus.PAID },
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });

      await service.markPaymentVerified('app-1', 'staff-1');

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.PAYMENT_VERIFIED },
      });
    });

    it('rejects when the invoice is not fully paid', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.PAYMENT_PENDING,
        invoice: { status: InvoiceStatus.ISSUED },
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });

      await expect(service.markPaymentVerified('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects when the application is not in PAYMENT_PENDING', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...applicationRow,
        status: VisaApplicationStatus.SUBMITTED,
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });

      await expect(service.markPaymentVerified('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('assign', () => {
    it('sets assignedStaffId and records an audit entry', async () => {
      prisma.visaApplication.update.mockResolvedValue({ ...applicationRow, assignedStaffId: 'staff-2' });

      await service.assign('app-1', 'staff-2', 'identity-9');

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { assignedStaffId: 'staff-2' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_application.assigned' }),
      );
    });
  });

  describe('addNote', () => {
    it('creates a VisaApplicationNote and audits it', async () => {
      prisma.visaApplicationNote.create.mockResolvedValue({ id: 'note-1' });

      await service.addNote('app-1', 'staff-1', 'Passport copy looks blurry');

      expect(prisma.visaApplicationNote.create).toHaveBeenCalledWith({
        data: { applicationId: 'app-1', staffId: 'staff-1', note: 'Passport copy looks blurry' },
      });
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
