import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, ManualPaymentStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IncentivesService } from '../incentives/incentives.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { ManualPaymentsService } from './manual-payments.service';

describe('ManualPaymentsService', () => {
  let service: ManualPaymentsService;
  let prisma: Record<string, any>;
  let invoicesService: { recomputeStatus: jest.Mock };
  let notificationsService: { sendManualPaymentStatus: jest.Mock };
  let auditService: { record: jest.Mock };
  let incentivesService: { applyForInvoicePayment: jest.Mock };

  beforeEach(async () => {
    prisma = {
      invoice: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      manualPaymentSubmission: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: { create: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    invoicesService = { recomputeStatus: jest.fn() };
    notificationsService = { sendManualPaymentStatus: jest.fn() };
    auditService = { record: jest.fn() };
    incentivesService = { applyForInvoicePayment: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManualPaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
        { provide: IncentivesService, useValue: incentivesService },
      ],
    }).compile();

    service = module.get(ManualPaymentsService);
  });

  describe('submit', () => {
    it('never creates a Payment row — submitting has no ledger effect', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'customer-1',
        status: InvoiceStatus.ISSUED,
        totalAmount: 50_000,
        payments: [],
      });
      prisma.manualPaymentSubmission.create.mockResolvedValue({ id: 'sub-1' });

      await service.submit(
        'customer-1',
        {
          customerId: 'customer-1',
          invoiceId: 'invoice-1',
          amount: 20_000,
          method: PaymentMethod.BANK_TRANSFER,
        },
        'staff-1',
        'identity-1',
      );

      expect(prisma.manualPaymentSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ManualPaymentStatus.PENDING_VERIFICATION,
          }),
        }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects a submission that exceeds the outstanding balance', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'customer-1',
        status: InvoiceStatus.PARTIALLY_PAID,
        totalAmount: 50_000,
        payments: [{ amount: 45_000 }],
      });

      await expect(
        service.submit(
          'customer-1',
          { customerId: 'customer-1', invoiceId: 'invoice-1', amount: 10_000, method: PaymentMethod.CASH },
          'staff-1',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approve', () => {
    const pendingSubmission = {
      id: 'sub-1',
      invoiceId: 'invoice-1',
      customerId: 'customer-1',
      amount: 20_000,
      method: PaymentMethod.BANK_TRANSFER,
      description: null,
      submittedByStaffId: 'staff-front',
      status: ManualPaymentStatus.PENDING_VERIFICATION,
      invoice: { invoiceNumber: 'INV-ABCD1234', currency: 'NGN' },
      customer: { identityId: 'identity-1', identity: { email: 'amina@example.com' } },
    };

    it('rejects approving a submission that is not PENDING_VERIFICATION', async () => {
      prisma.manualPaymentSubmission.findUnique.mockResolvedValue({
        ...pendingSubmission,
        status: ManualPaymentStatus.APPROVED,
      });

      await expect(
        service.approve('sub-1', 'staff-finance', 'ok', 'identity-finance'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('re-checks the outstanding balance at approval time (it may have shrunk since submission)', async () => {
      prisma.manualPaymentSubmission.findUnique.mockResolvedValue(pendingSubmission);
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        totalAmount: 50_000,
        payments: [{ amount: 35_000 }], // only 15,000 left — less than the submitted 20,000
      });

      await expect(
        service.approve('sub-1', 'staff-finance', undefined, 'identity-finance'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('creates the Payment row, links it back, recomputes the invoice, and applies incentives', async () => {
      prisma.manualPaymentSubmission.findUnique.mockResolvedValue(pendingSubmission);
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-ABCD1234',
        currency: 'NGN',
        totalAmount: 50_000,
        payments: [],
      });
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' });
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.PARTIALLY_PAID,
      });

      const result = await service.approve('sub-1', 'staff-finance', 'looks good', 'identity-finance');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceId: 'invoice-1',
            amount: 20_000,
            method: PaymentMethod.BANK_TRANSFER,
            recordedByStaffId: 'staff-front',
          }),
        }),
      );
      expect(prisma.manualPaymentSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ManualPaymentStatus.APPROVED,
            reviewedByStaffId: 'staff-finance',
            paymentId: 'payment-1',
          }),
        }),
      );
      expect(notificationsService.sendManualPaymentStatus).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ status: 'APPROVED' }),
      );
      expect(incentivesService.applyForInvoicePayment).toHaveBeenCalledWith('invoice-1', 20_000);
      expect(result.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });
  });

  describe('reject', () => {
    it('never creates a Payment row and records the rejection reason', async () => {
      prisma.manualPaymentSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: ManualPaymentStatus.PENDING_VERIFICATION,
        invoiceId: 'invoice-1',
        amount: 20_000,
        invoice: { invoiceNumber: 'INV-ABCD1234', currency: 'NGN' },
        customer: { identityId: 'identity-1', identity: { email: 'amina@example.com' } },
      });
      prisma.manualPaymentSubmission.update.mockResolvedValue({
        status: ManualPaymentStatus.REJECTED,
      });

      await service.reject('sub-1', 'staff-finance', 'receipt illegible', 'identity-finance');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.manualPaymentSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ManualPaymentStatus.REJECTED,
            reviewNote: 'receipt illegible',
          }),
        }),
      );
    });
  });

  describe('getOne', () => {
    it('throws NotFound for an unknown id', async () => {
      prisma.manualPaymentSubmission.findUnique.mockResolvedValue(null);

      await expect(service.getOne('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
