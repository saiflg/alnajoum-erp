import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let invoicesService: { recomputeStatus: jest.Mock };
  let notificationsService: { sendPaymentReceipt: jest.Mock };

  beforeEach(async () => {
    prisma = {
      invoice: { findUnique: jest.fn() },
      payment: { create: jest.fn() },
      customer: { findUnique: jest.fn() },
    };
    invoicesService = { recomputeStatus: jest.fn() };
    notificationsService = { sendPaymentReceipt: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('throws NotFound when the invoice does not exist', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);

    await expect(
      service.recordPayment('missing', {
        amount: 1000,
        method: PaymentMethod.CASH,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a payment against a VOID invoice', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.VOID,
      totalAmount: 50_000,
      payments: [],
    });

    await expect(
      service.recordPayment('invoice-1', {
        amount: 1000,
        method: PaymentMethod.CASH,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a payment against an already-PAID invoice', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PAID,
      totalAmount: 50_000,
      payments: [{ amount: 50_000 }],
    });

    await expect(
      service.recordPayment('invoice-1', {
        amount: 1000,
        method: PaymentMethod.CASH,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a payment amount that exceeds the outstanding balance', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PARTIALLY_PAID,
      totalAmount: 50_000,
      payments: [{ amount: 30_000 }],
    });

    await expect(
      service.recordPayment('invoice-1', {
        amount: 25_000, // balance is only 20,000
        method: PaymentMethod.CASH,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('records a valid payment, recomputes the invoice status, and emails a receipt', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      invoiceNumber: 'INV-ABCD1234',
      customerId: 'customer-1',
      currency: 'NGN',
      status: InvoiceStatus.ISSUED,
      totalAmount: 50_000,
      payments: [],
    });
    prisma.customer.findUnique.mockResolvedValue({
      id: 'customer-1',
      identity: { email: 'amina@example.com' },
    });
    invoicesService.recomputeStatus.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PARTIALLY_PAID,
    });

    const result = await service.recordPayment(
      'invoice-1',
      {
        amount: 20_000,
        method: PaymentMethod.BANK_TRANSFER,
        note: 'part payment',
      },
      'staff-1',
    );

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: 'invoice-1',
          amount: 20_000,
          method: PaymentMethod.BANK_TRANSFER,
          note: 'part payment',
          recordedByStaffId: 'staff-1',
        }),
      }),
    );
    expect(invoicesService.recomputeStatus).toHaveBeenCalledWith('invoice-1');
    expect(notificationsService.sendPaymentReceipt).toHaveBeenCalledWith(
      'amina@example.com',
      {
        invoiceNumber: 'INV-ABCD1234',
        amount: 20_000,
        balance: 30_000,
        currency: 'NGN',
      },
    );
    expect(result.status).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  it('allows a payment that exactly covers the remaining balance', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PARTIALLY_PAID,
      totalAmount: 50_000,
      payments: [{ amount: 30_000 }],
    });
    invoicesService.recomputeStatus.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PAID,
    });

    await service.recordPayment('invoice-1', {
      amount: 20_000,
      method: PaymentMethod.CASH,
    });

    expect(prisma.payment.create).toHaveBeenCalled();
  });
});
