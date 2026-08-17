import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  PaymentIntentStatus,
  PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.port';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let invoicesService: { recomputeStatus: jest.Mock; getInvoice: jest.Mock };
  let notificationsService: { sendPaymentReceipt: jest.Mock };
  let paymentProvider: {
    initiateCheckout: jest.Mock;
    verifyCheckout: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      invoice: { findUnique: jest.fn() },
      payment: { create: jest.fn() },
      paymentIntent: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
    };
    invoicesService = {
      recomputeStatus: jest.fn(),
      getInvoice: jest.fn(),
    };
    notificationsService = { sendPaymentReceipt: jest.fn() };
    paymentProvider = {
      initiateCheckout: jest.fn(),
      verifyCheckout: jest.fn(),
    };
    configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: configService },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('recordPayment', () => {
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

  describe('initiateCheckout', () => {
    const baseInvoice = {
      id: 'invoice-1',
      customerId: 'customer-1',
      currency: 'NGN',
      totalAmount: 50_000,
      payments: [],
    };

    it('throws NotFound when the invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateCheckout('customer-1', 'invoice-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when the invoice belongs to a different customer', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.ISSUED,
      });

      await expect(
        service.initiateCheckout('someone-else', 'invoice-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects checkout on a VOID invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.VOID,
      });

      await expect(
        service.initiateCheckout('customer-1', 'invoice-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects checkout on an already-PAID invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.PAID,
        payments: [{ amount: 50_000 }],
      });

      await expect(
        service.initiateCheckout('customer-1', 'invoice-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a PENDING PaymentIntent for the outstanding balance and calls the provider', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.PARTIALLY_PAID,
        payments: [{ amount: 20_000 }],
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });
      prisma.paymentIntent.create.mockResolvedValue({
        id: 'intent-1',
        reference: 'CHK-ABC123',
      });
      paymentProvider.initiateCheckout.mockResolvedValue({
        authorizationUrl: 'https://mock-checkout.example/pay',
        reference: 'CHK-ABC123',
      });

      const result = await service.initiateCheckout('customer-1', 'invoice-1');

      expect(prisma.paymentIntent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceId: 'invoice-1',
            customerId: 'customer-1',
            amount: 30_000, // 50,000 - 20,000
            currency: 'NGN',
            status: PaymentIntentStatus.PENDING,
          }),
        }),
      );
      expect(paymentProvider.initiateCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 30_000,
          currency: 'NGN',
          customerEmail: 'amina@example.com',
        }),
      );
      expect(result).toEqual({
        authorizationUrl: 'https://mock-checkout.example/pay',
        reference: 'CHK-ABC123',
      });
    });
  });

  describe('verifyCheckout', () => {
    const pendingIntent = {
      id: 'intent-1',
      invoiceId: 'invoice-1',
      customerId: 'customer-1',
      reference: 'CHK-ABC123',
      provider: 'mock',
      amount: 30_000,
      currency: 'NGN',
      status: PaymentIntentStatus.PENDING,
    };

    it('throws NotFound for an unknown reference', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-NOPE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when the checkout belongs to a different customer', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);

      await expect(
        service.verifyCheckout('someone-else', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequest when the reference does not belong to the given invoice', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);

      await expect(
        service.verifyCheckout(
          'customer-1',
          'some-other-invoice',
          'CHK-ABC123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('is idempotent: returns the invoice directly if already SUCCEEDED, without re-calling the provider', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        ...pendingIntent,
        status: PaymentIntentStatus.SUCCEEDED,
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(paymentProvider.verifyCheckout).not.toHaveBeenCalled();
      expect(invoicesService.getInvoice).toHaveBeenCalledWith(
        'invoice-1',
        'customer-1',
      );
    });

    it('throws Conflict when the provider reports the payment failed', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: false,
        amount: 0,
        currency: '',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PaymentIntentStatus.FAILED },
        }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('throws Conflict when the provider-confirmed amount does not match', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 15_000, // intent expects 30,000
        currency: 'NGN',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('records an ONLINE payment, recomputes status, and emails a receipt on success', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-ABCD1234',
        status: InvoiceStatus.PAID,
        totalAmount: 50_000,
        currency: 'NGN',
        payments: [{ amount: 20_000 }, { amount: 30_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PaymentIntentStatus.SUCCEEDED },
        }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentReference: 'CHK-ABC123',
            invoiceId: 'invoice-1',
            amount: 30_000,
            method: PaymentMethod.ONLINE,
            recordedByStaffId: null,
          }),
        }),
      );
      expect(notificationsService.sendPaymentReceipt).toHaveBeenCalledWith(
        'amina@example.com',
        expect.objectContaining({ amount: 30_000, balance: 0 }),
      );
    });

    it("accepts the mock provider's unverified amount (0) and trusts the PaymentIntent's own amount", async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 0,
        currency: '',
      });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-ABCD1234',
        status: InvoiceStatus.PAID,
        totalAmount: 50_000,
        currency: 'NGN',
        payments: [{ amount: 50_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 30_000 }),
        }),
      );
    });
  });

  describe('handleProviderWebhookEvent', () => {
    it('silently ignores a reference it does not recognize', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(null);

      await expect(
        service.handleProviderWebhookEvent('CHK-UNKNOWN', {
          reference: 'CHK-UNKNOWN',
          success: true,
          amount: 1000,
          currency: 'NGN',
        }),
      ).resolves.toBeUndefined();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('silently skips an already-SUCCEEDED intent (webhook arriving after the customer-facing verify)', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        invoiceId: 'invoice-1',
        customerId: 'customer-1',
        reference: 'CHK-ABC123',
        provider: 'paystack',
        amount: 30_000,
        currency: 'NGN',
        status: PaymentIntentStatus.SUCCEEDED,
      });

      await service.handleProviderWebhookEvent('CHK-ABC123', {
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('finalizes a matching PENDING intent without throwing', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        invoiceId: 'invoice-1',
        customerId: 'customer-1',
        reference: 'CHK-ABC123',
        provider: 'paystack',
        amount: 30_000,
        currency: 'NGN',
        status: PaymentIntentStatus.PENDING,
      });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-ABCD1234',
        status: InvoiceStatus.PAID,
        totalAmount: 30_000,
        currency: 'NGN',
        payments: [{ amount: 30_000 }],
      });

      await service.handleProviderWebhookEvent('CHK-ABC123', {
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ method: PaymentMethod.ONLINE }),
        }),
      );
    });
  });
});
