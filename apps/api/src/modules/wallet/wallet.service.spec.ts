import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  PaymentMethod,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IncentivesService } from '../incentives/incentives.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { PAYMENT_PROVIDER } from '../payments/providers/payment-provider.port';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: Record<string, any>;
  let invoicesService: { recomputeStatus: jest.Mock };
  let notificationsService: {
    sendWalletUpdate: jest.Mock;
    sendPaymentReceipt: jest.Mock;
  };
  let auditService: { record: jest.Mock };
  let incentivesService: { applyForInvoicePayment: jest.Mock };
  let paymentProvider: { initiateCheckout: jest.Mock; verifyCheckout: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      wallet: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
      walletTransaction: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      invoice: { findUnique: jest.fn() },
      payment: { create: jest.fn() },
      // Handles both $transaction call shapes: a callback (payInvoiceWithWallet)
      // and an array of already-built promises (transferBetweenWallets).
      $transaction: jest.fn((arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };
    invoicesService = { recomputeStatus: jest.fn() };
    notificationsService = {
      sendWalletUpdate: jest.fn(),
      sendPaymentReceipt: jest.fn(),
    };
    auditService = { record: jest.fn() };
    incentivesService = { applyForInvoicePayment: jest.fn() };
    paymentProvider = { initiateCheckout: jest.fn(), verifyCheckout: jest.fn() };
    configService = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
        { provide: IncentivesService, useValue: incentivesService },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
      ],
    }).compile();

    service = module.get(WalletService);
  });

  describe('computeBalance', () => {
    it('sums only COMPLETED transactions', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 15_000 } });

      const balance = await service.computeBalance('wallet-1');

      expect(prisma.walletTransaction.aggregate).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', status: WalletTransactionStatus.COMPLETED },
        _sum: { amount: true },
      });
      expect(balance).toBe(15_000);
    });

    it('returns 0 when there are no transactions yet', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } });

      expect(await service.computeBalance('wallet-1')).toBe(0);
    });
  });

  describe('payInvoiceWithWallet', () => {
    beforeEach(() => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
    });

    it('rejects when the wallet balance is less than the requested amount', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5_000 } });

      await expect(
        service.payInvoiceWithWallet('customer-1', 'invoice-1', 10_000),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when the invoice does not exist', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.payInvoiceWithWallet('customer-1', 'invoice-1', 10_000),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the invoice belongs to a different customer', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'someone-else',
        status: InvoiceStatus.ISSUED,
        totalAmount: 50_000,
        payments: [],
      });

      await expect(
        service.payInvoiceWithWallet('customer-1', 'invoice-1', 10_000),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects paying a VOID invoice', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'customer-1',
        status: InvoiceStatus.VOID,
        totalAmount: 50_000,
        payments: [],
      });

      await expect(
        service.payInvoiceWithWallet('customer-1', 'invoice-1', 10_000),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an amount exceeding the outstanding balance', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'customer-1',
        status: InvoiceStatus.PARTIALLY_PAID,
        totalAmount: 50_000,
        payments: [{ amount: 45_000 }],
      });

      await expect(
        service.payInvoiceWithWallet('customer-1', 'invoice-1', 10_000), // balance is only 5,000
      ).rejects.toThrow(BadRequestException);
    });

    it('debits the wallet and creates a WALLET payment atomically, then recomputes the invoice', async () => {
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
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
        identity: { email: 'amina@example.com', id: 'identity-1' },
      });
      invoicesService.recomputeStatus.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.PARTIALLY_PAID,
      });

      const result = await service.payInvoiceWithWallet('customer-1', 'invoice-1', 20_000);

      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 'wallet-1',
            type: WalletTransactionType.PAYMENT,
            amount: -20_000,
            invoiceId: 'invoice-1',
          }),
        }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceId: 'invoice-1',
            amount: 20_000,
            method: PaymentMethod.WALLET,
          }),
        }),
      );
      expect(incentivesService.applyForInvoicePayment).toHaveBeenCalledWith('invoice-1', 20_000);
      expect(result.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });
  });

  describe('adjust', () => {
    it('rejects a debit that would take the balance negative', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5_000 } });

      await expect(
        service.adjust('customer-1', -10_000, WalletTransactionType.WITHDRAWAL, 'over-withdrawal', 'staff-1', 'identity-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('allows a debit that leaves the balance at exactly zero', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10_000 } });
      prisma.customer.findUnique.mockResolvedValue(null);

      await service.adjust('customer-1', -10_000, WalletTransactionType.WITHDRAWAL, 'full withdrawal', 'staff-1', 'identity-1');

      expect(prisma.walletTransaction.create).toHaveBeenCalled();
    });

    it('records the audit entry against the acting staff identity, not the customer', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identityId: 'customer-identity',
        identity: { email: 'amina@example.com' },
      });

      await service.adjust('customer-1', 5_000, WalletTransactionType.ADJUSTMENT, 'correction', 'staff-1', 'staff-identity');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ identityId: 'staff-identity', action: 'wallet.adjusted' }),
      );
    });
  });

  describe('finalizeDeposit (via verifyDeposit)', () => {
    const pendingTransaction = {
      id: 'txn-1',
      walletId: 'wallet-1',
      type: WalletTransactionType.DEPOSIT,
      status: WalletTransactionStatus.PENDING,
      amount: 20_000,
      currency: 'NGN',
      reference: 'WDEP-ABC123',
      wallet: { customerId: 'customer-1' },
    };

    it('throws NotFound for an unknown reference', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyDeposit('customer-1', 'WDEP-NOPE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when the deposit belongs to a different customer', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(pendingTransaction);

      await expect(
        service.verifyDeposit('someone-else', 'WDEP-ABC123'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks the transaction FAILED when the provider reports failure, without crediting the wallet', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(pendingTransaction);
      prisma.walletTransaction.findUniqueOrThrow.mockResolvedValue({
        ...pendingTransaction,
        wallet: { customer: { identityId: 'identity-1', identity: { email: 'a@example.com' } } },
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'WDEP-ABC123',
        success: false,
        amount: 0,
        currency: '',
      });
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.walletTransaction.updateMany.mockResolvedValue({ count: 1 });

      await service.verifyDeposit('customer-1', 'WDEP-ABC123');

      expect(prisma.walletTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'txn-1', status: WalletTransactionStatus.PENDING },
          data: { status: WalletTransactionStatus.FAILED },
        }),
      );
      expect(notificationsService.sendWalletUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when a concurrent call already claimed the transaction (updateMany count 0)', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(pendingTransaction);
      prisma.walletTransaction.findUniqueOrThrow.mockResolvedValue({
        ...pendingTransaction,
        wallet: { customer: { identityId: 'identity-1', identity: { email: 'a@example.com' } } },
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'WDEP-ABC123',
        success: true,
        amount: 0,
        currency: '',
      });
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 20_000 } });
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.walletTransaction.updateMany.mockResolvedValue({ count: 0 });

      await service.verifyDeposit('customer-1', 'WDEP-ABC123');

      expect(notificationsService.sendWalletUpdate).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('completes the transaction and notifies the customer on success', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(pendingTransaction);
      prisma.walletTransaction.findUniqueOrThrow.mockResolvedValue({
        ...pendingTransaction,
        wallet: {
          customer: {
            identityId: 'identity-1',
            identity: { email: 'amina@example.com' },
          },
        },
      });
      paymentProvider.verifyCheckout.mockResolvedValue({
        reference: 'WDEP-ABC123',
        success: true,
        amount: 0,
        currency: '',
      });
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 20_000 } });
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.walletTransaction.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyDeposit('customer-1', 'WDEP-ABC123');

      expect(prisma.walletTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'txn-1', status: WalletTransactionStatus.PENDING },
          data: { status: WalletTransactionStatus.COMPLETED },
        }),
      );
      expect(notificationsService.sendWalletUpdate).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ type: 'DEPOSIT', amount: 20_000 }),
      );
      expect(result.balance).toBe(20_000);
    });

    it('is idempotent: does not re-call the provider once already COMPLETED', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue({
        ...pendingTransaction,
        status: WalletTransactionStatus.COMPLETED,
      });
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', customerId: 'customer-1', currency: 'NGN' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 20_000 } });
      prisma.walletTransaction.findMany.mockResolvedValue([]);

      await service.verifyDeposit('customer-1', 'WDEP-ABC123');

      expect(paymentProvider.verifyCheckout).not.toHaveBeenCalled();
    });
  });

  describe('transferBetweenWallets', () => {
    it('rejects transferring to the same customer', async () => {
      await expect(
        service.transferBetweenWallets(
          'customer-1',
          'customer-1',
          10_000,
          'test',
          'staff-1',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a transfer that exceeds the source wallet balance', async () => {
      prisma.wallet.findUnique.mockImplementation(({ where }: any) =>
        where.customerId === 'customer-1'
          ? { id: 'wallet-from', customerId: 'customer-1', currency: 'NGN' }
          : { id: 'wallet-to', customerId: 'customer-2', currency: 'NGN' },
      );
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5_000 } });

      await expect(
        service.transferBetweenWallets(
          'customer-1',
          'customer-2',
          10_000,
          'test',
          'staff-1',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('debits the source and credits the destination atomically', async () => {
      prisma.wallet.findUnique.mockImplementation(({ where }: any) =>
        where.customerId === 'customer-1'
          ? { id: 'wallet-from', customerId: 'customer-1', currency: 'NGN' }
          : { id: 'wallet-to', customerId: 'customer-2', currency: 'NGN' },
      );
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.customer.findUnique.mockImplementation(({ where }: any) =>
        where.id === 'customer-1'
          ? { identityId: 'identity-from', identity: { email: 'from@example.com' } }
          : { identityId: 'identity-to', identity: { email: 'to@example.com' } },
      );

      const result = await service.transferBetweenWallets(
        'customer-1',
        'customer-2',
        20_000,
        'gift',
        'staff-1',
        'staff-identity',
      );

      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 'wallet-from',
            type: WalletTransactionType.TRANSFER_OUT,
            amount: -20_000,
          }),
        }),
      );
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 'wallet-to',
            type: WalletTransactionType.TRANSFER_IN,
            amount: 20_000,
          }),
        }),
      );
      expect(notificationsService.sendWalletUpdate).toHaveBeenCalledWith(
        'from@example.com',
        'identity-from',
        expect.objectContaining({ type: 'DEBIT' }),
      );
      expect(notificationsService.sendWalletUpdate).toHaveBeenCalledWith(
        'to@example.com',
        'identity-to',
        expect.objectContaining({ type: 'DEPOSIT' }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'staff-identity',
          action: 'wallet.transferred',
          metadata: expect.objectContaining({
            fromCustomerId: 'customer-1',
            toCustomerId: 'customer-2',
            amount: 20_000,
          }),
        }),
      );
      expect(result.from.balance).toBe(50_000);
      expect(result.to.balance).toBe(50_000);
    });
  });
});
