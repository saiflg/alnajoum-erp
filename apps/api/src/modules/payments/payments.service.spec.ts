import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  PaymentIntentStatus,
  PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { LedgerService } from '../finance/ledger.service';
import { IncentivesService } from '../incentives/incentives.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.port';
import { PaymentProviderRouter } from './providers/payment-provider.router';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let invoicesService: { recomputeStatus: jest.Mock; getInvoice: jest.Mock };
  let notificationsService: { sendPaymentReceipt: jest.Mock };
  let incentivesService: { applyForInvoicePayment: jest.Mock };
  let paymentProvider: {
    initiateCheckout: jest.Mock;
    verifyCheckout: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let integrationsService: { getActiveProvider: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let paymentProviderRouter: { resolveByName: jest.Mock };
  let ledgerService: { post: jest.Mock };

  beforeEach(async () => {
    prisma = {
      invoice: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      payment: { create: jest.fn() },
      paymentIntent: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      wallet: { upsert: jest.fn() },
      walletTransaction: { create: jest.fn() },
    } as typeof prisma;
    // Interactive-transaction plumbing used by the concurrency guards (src/common/db/payment-guards).
    (prisma as Record<string, unknown>).$executeRaw = jest
      .fn()
      .mockResolvedValue(1);
    (prisma as Record<string, unknown>).$transaction = jest.fn(
      (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
    );
    // Default standing for the guard's re-read inside the transaction; tests override as needed.
    prisma.invoice.findUnique.mockResolvedValue({
      status: 'ISSUED',
      totalAmount: 1_000_000,
      payments: [],
    });
    invoicesService = {
      recomputeStatus: jest.fn(),
      getInvoice: jest.fn(),
    };
    notificationsService = { sendPaymentReceipt: jest.fn() };
    incentivesService = { applyForInvoicePayment: jest.fn() };
    paymentProvider = {
      initiateCheckout: jest.fn(),
      verifyCheckout: jest.fn(),
    };
    configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };
    integrationsService = {
      getActiveProvider: jest.fn().mockResolvedValue(null),
    };
    eventEmitter = { emit: jest.fn() };
    paymentProviderRouter = {
      resolveByName: jest.fn().mockReturnValue(paymentProvider),
    };
    ledgerService = { post: jest.fn().mockResolvedValue({ id: 'je-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: IncentivesService, useValue: incentivesService },
        { provide: ConfigService, useValue: configService },
        { provide: IntegrationsService, useValue: integrationsService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: PaymentProviderRouter, useValue: paymentProviderRouter },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
        {
          provide: FinancePostingService,
          useValue: { postRevenueForPayment: jest.fn() },
        },
        { provide: LedgerService, useValue: ledgerService },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('recordPayment', () => {
    it('re-checks the balance under the invoice lock, so two simultaneous payments cannot both fit', async () => {
      // Both requests pass the pre-check against an unpaid invoice...
      prisma.invoice.findUnique
        .mockResolvedValueOnce({
          id: 'invoice-1',
          status: InvoiceStatus.ISSUED,
          totalAmount: 50_000,
          payments: [],
        })
        // ...but the second one, once it holds the lock, sees the first payment already counted.
        .mockResolvedValueOnce({
          status: InvoiceStatus.PARTIALLY_PAID,
          totalAmount: 50_000,
          payments: [{ amount: 40_000 }],
        });

      await expect(
        service.recordPayment('invoice-1', {
          amount: 30_000,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow(/exceeds the outstanding balance \(10000\)/);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(
        (prisma as Record<string, unknown>).$executeRaw,
      ).toHaveBeenCalled();
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
        amount: 30_000,
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

    it('refuses a second checkout while a recent one is still PENDING, and writes no second intent', async () => {
      // Regression for a double-payment found by the Phase 24 financial reconciliation: two concurrent
      // checkouts on one unpaid invoice each created a full-balance intent and both settled.
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.ISSUED,
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });
      prisma.paymentIntent.findFirst.mockResolvedValue({
        id: 'earlier-intent',
      });

      await expect(
        service.initiateCheckout('customer-1', 'invoice-1'),
      ).rejects.toThrow(/already in progress/);

      expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
      expect(paymentProvider.initiateCheckout).not.toHaveBeenCalled();
      // only a PENDING intent for THIS invoice, and only a recent one, blocks a new checkout
      expect(prisma.paymentIntent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            invoiceId: 'invoice-1',
            status: PaymentIntentStatus.PENDING,
            createdAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });

    it('re-reads the balance inside the lock: a payment that landed meanwhile stops the checkout', async () => {
      prisma.invoice.findUnique
        .mockResolvedValueOnce({ ...baseInvoice, status: InvoiceStatus.ISSUED })
        // the standing read under the invoice lock now shows it fully paid
        .mockResolvedValue({
          ...baseInvoice,
          status: InvoiceStatus.PAID,
          payments: [{ amount: 50_000 }],
        });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'amina@example.com' },
      });

      await expect(
        service.initiateCheckout('customer-1', 'invoice-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
    });

    it('records the DB-driven active provider on the PaymentIntent, not just the env var fallback', async () => {
      // Regression test for a real bug found while building the WhatsApp
      // payment-link reconciliation poller: this must match whatever
      // PaymentProviderRouter.resolve() actually uses, or reconciliation
      // looks up the wrong provider for an intent created after an admin
      // switched providers via /admin/integrations rather than the env var.
      integrationsService.getActiveProvider.mockResolvedValue('paystack');
      prisma.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        status: InvoiceStatus.ISSUED,
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
        authorizationUrl: 'https://paystack.example/pay',
        reference: 'CHK-ABC123',
      });

      await service.initiateCheckout('customer-1', 'invoice-1');

      expect(prisma.paymentIntent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: 'paystack' }),
        }),
      );
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

    it('verifies with the provider that issued the intent, not the active one', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        ...pendingIntent,
        provider: 'paystack',
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: false,
        pending: true,
        amount: 0,
        currency: '',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
      expect(paymentProviderRouter.resolveByName).toHaveBeenCalledWith(
        'paystack',
      );
    });

    it('keeps the intent PENDING (not FAILED) when the provider says it is still pending', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: false,
        pending: true,
        amount: 0,
        currency: '',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
      expect(prisma.paymentIntent.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('does not credit, and does not permanently fail, a real-provider success with zero amount', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        ...pendingIntent,
        provider: 'paystack',
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 0,
        currency: '',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
      expect(prisma.paymentIntent.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('does not credit a payment confirmed in the wrong currency', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        ...pendingIntent,
        provider: 'paystack',
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'USD',
      });

      await expect(
        service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123'),
      ).rejects.toThrow(ConflictException);
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

    it('credits money the gateway really took to the customer wallet when the invoice was settled meanwhile (nothing is applied to the invoice)', async () => {
      // Found by the Phase 24 financial reconciliation: an abandoned checkout completed hours later, after
      // cash had already settled the invoice, and left it over-paid by a whole payment.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
      // Paid in full by someone else in the meantime.
      prisma.invoice.findUnique.mockResolvedValue({
        status: InvoiceStatus.PAID,
        totalAmount: 30_000,
        payments: [{ amount: 30_000 }],
      });
      prisma.customer.findUniqueOrThrow.mockResolvedValue({
        companyId: 'company-1',
      });
      prisma.wallet.upsert.mockResolvedValue({ id: 'wallet-1' });
      prisma.walletTransaction.create.mockResolvedValue({
        id: 'wt-1',
        reference: 'SURPLUS-CHK-ABC123',
        description: 'Surplus',
      });
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'invoice-1' });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        totalAmount: 30_000,
        currency: 'NGN',
        payments: [{ amount: 30_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      // the invoice is not pushed past its total...
      expect(prisma.payment.create).not.toHaveBeenCalled();
      // ...the whole amount becomes credit on the customer's wallet...
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          walletId: 'wallet-1',
          type: 'DEPOSIT',
          status: 'COMPLETED',
          amount: 30_000,
          reference: 'SURPLUS-CHK-ABC123',
          invoiceId: 'invoice-1',
        }),
      });
      // ...with its own, balanced ledger entry, in the same transaction.
      expect(ledgerService.post).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 30_000,
          reference: 'SURPLUS-CHK-ABC123',
          sourceModule: 'WALLET',
          companyId: 'company-1',
        }),
        expect.anything(),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('credited to the customer'),
      );
      warn.mockRestore();
    });

    it('applies only the outstanding part to the invoice and credits the rest, when a checkout lands after a partial settlement', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
      // 20,000 of 30,000 already paid -> only 10,000 is still owed.
      prisma.invoice.findUnique.mockResolvedValue({
        status: InvoiceStatus.PARTIALLY_PAID,
        totalAmount: 30_000,
        payments: [{ amount: 20_000 }],
      });
      prisma.payment.create.mockResolvedValue({ id: 'p-1' });
      prisma.customer.findUniqueOrThrow.mockResolvedValue({
        companyId: 'company-1',
      });
      prisma.wallet.upsert.mockResolvedValue({ id: 'wallet-1' });
      prisma.walletTransaction.create.mockResolvedValue({
        id: 'wt-1',
        reference: 'SURPLUS-CHK-ABC123',
        description: 'Surplus',
      });
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'invoice-1' });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        totalAmount: 30_000,
        currency: 'NGN',
        payments: [{ amount: 20_000 }, { amount: 10_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 10_000 }),
      });
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 20_000 }),
      });
      expect(ledgerService.post).toHaveBeenCalledTimes(1);
    });

    it('creates no wallet credit when the payment exactly settles the invoice', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findUnique.mockResolvedValue({
        status: InvoiceStatus.ISSUED,
        totalAmount: 30_000,
        payments: [],
      });
      prisma.payment.create.mockResolvedValue({ id: 'p-1' });
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'invoice-1' });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        totalAmount: 30_000,
        currency: 'NGN',
        payments: [{ amount: 30_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 30_000 }),
      });
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
      expect(ledgerService.post).not.toHaveBeenCalled();
    });

    it('writes the intent claim and the payment in one transaction under the invoice lock', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent);
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.create.mockResolvedValue({ id: 'p-1' });
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'invoice-1' });
      prisma.customer.findUnique.mockResolvedValue(null);
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        totalAmount: 30_000,
        currency: 'NGN',
        payments: [{ amount: 30_000 }],
      });
      invoicesService.getInvoice.mockResolvedValue({ id: 'invoice-1' });
      const tx = prisma as unknown as {
        $transaction: jest.Mock;
        $executeRaw: jest.Mock;
      };

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(tx.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalled();
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
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.paymentIntent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-1', status: PaymentIntentStatus.PENDING },
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
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'invoice.payment.succeeded',
        {
          invoiceId: 'invoice-1',
          customerId: 'customer-1',
          amount: 30_000,
          currency: 'NGN',
        },
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
        simulated: true,
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
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });

      await service.verifyCheckout('customer-1', 'invoice-1', 'CHK-ABC123');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 30_000 }),
        }),
      );
    });
  });

  describe('handleProviderWebhookEvent', () => {
    it('hands a wallet top-up (WDEP-) to the wallet instead of treating it as an unknown invoice intent', async () => {
      const result = {
        reference: 'WDEP-1',
        success: true,
        amount: 1000,
        currency: 'NGN',
      };

      await service.handleProviderWebhookEvent('WDEP-1', result);

      expect(eventEmitter.emit).toHaveBeenCalledWith('wallet.deposit.webhook', {
        reference: 'WDEP-1',
        result,
      });
      expect(prisma.paymentIntent.findUnique).not.toHaveBeenCalled();
    });

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
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });

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

    it('never creates a duplicate Payment when a concurrent call already claimed the intent', async () => {
      // Simulates the customer-facing verify and the webhook racing each
      // other for the same PENDING intent: both read PENDING, but only one
      // wins the atomic claim (updateMany count 1) — the other must see
      // count 0 and back off without ever calling payment.create.
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
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 0 });

      await service.handleProviderWebhookEvent('CHK-ABC123', {
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(notificationsService.sendPaymentReceipt).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePendingIntent', () => {
    it('returns ok:false for an unknown intent id', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue(null);

      const result = await service.reconcilePendingIntent('missing');

      expect(result).toEqual({
        ok: false,
        reason: 'Payment intent not found',
      });
      expect(paymentProviderRouter.resolveByName).not.toHaveBeenCalled();
    });

    it('no-ops for an intent that is no longer PENDING', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        status: PaymentIntentStatus.SUCCEEDED,
      });

      const result = await service.reconcilePendingIntent('intent-1');

      expect(result).toEqual({ ok: true });
      expect(paymentProviderRouter.resolveByName).not.toHaveBeenCalled();
    });

    it('verifies against the provider stored on the intent, not the currently active one', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        invoiceId: 'invoice-1',
        customerId: 'customer-1',
        reference: 'CHK-ABC123',
        provider: 'opay',
        amount: 30_000,
        currency: 'NGN',
        status: PaymentIntentStatus.PENDING,
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
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
      prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcilePendingIntent('intent-1');

      expect(paymentProviderRouter.resolveByName).toHaveBeenCalledWith('opay');
      expect(paymentProvider.verifyCheckout).toHaveBeenCalledWith('CHK-ABC123');
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'invoice.payment.succeeded',
        expect.objectContaining({ invoiceId: 'invoice-1' }),
      );
      expect(result).toEqual({ ok: true });
    });

    it('marks the intent FAILED when the provider reports it did not succeed', async () => {
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        invoiceId: 'invoice-1',
        customerId: 'customer-1',
        reference: 'CHK-ABC123',
        provider: 'opay',
        amount: 30_000,
        currency: 'NGN',
        status: PaymentIntentStatus.PENDING,
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'CHK-ABC123',
        success: false,
        amount: 0,
        currency: '',
      });

      const result = await service.reconcilePendingIntent('intent-1');

      expect(result).toEqual({
        ok: false,
        reason: 'The payment was not successful.',
      });
      expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PaymentIntentStatus.FAILED },
        }),
      );
    });
  });
});
