import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceStatus,
  PaymentMethod,
  Wallet,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ACCOUNT_CODES } from '../finance/constants/account-codes.constant';
import { FinancePostingService } from '../finance/finance-posting.service';
import { LedgerService } from '../finance/ledger.service';
import { IncentivesService } from '../incentives/incentives.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import {
  PAYMENT_PROVIDER,
  VerifyCheckoutResult,
} from '../payments/providers/payment-provider.port';
import type { PaymentProviderPort } from '../payments/providers/payment-provider.port';

function generateWalletReference(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly incentivesService: IncentivesService,
    private readonly financePostingService: FinancePostingService,
    private readonly ledgerService: LedgerService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  async getOrCreateWallet(customerId: string): Promise<Wallet> {
    const existing = await this.prisma.wallet.findUnique({
      where: { customerId },
    });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { customerId } });
  }

  /** Sum of COMPLETED transactions only — PENDING deposits and REVERSED/FAILED entries never count. */
  async computeBalance(walletId: string): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: { walletId, status: WalletTransactionStatus.COMPLETED },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async getWalletWithBalance(customerId: string) {
    const wallet = await this.getOrCreateWallet(customerId);
    const [balance, transactions] = await Promise.all([
      this.computeBalance(wallet.id),
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { wallet, balance, transactions };
  }

  async listAllWallets() {
    const wallets = await this.prisma.wallet.findMany({
      include: {
        customer: { select: { firstName: true, lastName: true, id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      wallets.map(async (wallet) => ({
        ...wallet,
        balance: await this.computeBalance(wallet.id),
      })),
    );
  }

  /**
   * Starts a customer-initiated online top-up. Mirrors
   * PaymentsService.initiateCheckout, but against a PENDING WalletTransaction
   * instead of a PaymentIntent — the wallet has no invoice to attach to.
   */
  async initiateDeposit(customerId: string, amount: number) {
    const wallet = await this.getOrCreateWallet(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true } } },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    const reference = generateWalletReference('WDEP');
    const transaction = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        amount,
        currency: wallet.currency,
        description: 'Online wallet top-up',
        reference,
      },
    });

    const webOrigin = this.configService.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    const callbackUrl = `${webOrigin}/portal/wallet?checkout_reference=${reference}`;

    const result = await this.paymentProvider.initiateCheckout({
      reference,
      amount,
      currency: wallet.currency,
      customerEmail: customer.identity.email,
      callbackUrl,
    });

    return {
      authorizationUrl: result.authorizationUrl,
      reference: transaction.reference,
    };
  }

  /** Called when the browser returns from the provider's hosted checkout page. */
  async verifyDeposit(customerId: string, reference: string) {
    const transaction = await this.prisma.walletTransaction.findUnique({
      where: { reference },
      include: { wallet: true },
    });
    if (!transaction) {
      throw new NotFoundException('No wallet deposit found for this reference');
    }
    if (transaction.wallet.customerId !== customerId) {
      throw new ForbiddenException(
        'This deposit does not belong to this customer',
      );
    }
    if (transaction.type !== WalletTransactionType.DEPOSIT) {
      throw new BadRequestException('This reference is not a wallet deposit');
    }

    if (transaction.status === WalletTransactionStatus.COMPLETED) {
      return this.getWalletWithBalance(customerId);
    }

    const result = await this.paymentProvider.verifyCheckout(reference);
    await this.finalizeDeposit(transaction.id, result);
    return this.getWalletWithBalance(customerId);
  }

  private async finalizeDeposit(
    transactionId: string,
    result: VerifyCheckoutResult,
  ): Promise<void> {
    const transaction = await this.prisma.walletTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: {
        wallet: { include: { customer: { include: { identity: true } } } },
      },
    });
    if (transaction.status !== WalletTransactionStatus.PENDING) return;

    // Defense in depth, same as PaymentsService.finalizeIntent: the mock
    // provider reports amount 0 (nothing independently to check against),
    // a real gateway always reports a real confirmed amount.
    const succeeded =
      result.success &&
      !(result.amount > 0 && result.amount !== transaction.amount);

    // Atomically claims the PENDING -> final-status transition, gated on
    // still being PENDING. This is what makes two concurrent verify calls
    // for the same transaction safe — a real possibility: React Strict
    // Mode double-invokes effects in dev, and a network retry or a user
    // double-click before the button disables can do the same in
    // production. Without this, both calls can read PENDING before
    // either writes, both pass the check above, and both go on to send a
    // duplicate notification (observed live) — or worse, duplicate a real
    // ledger-affecting write elsewhere. Only the caller whose update
    // actually changes a row (count 1) proceeds; a concurrent loser sees
    // count 0 and quietly backs off.
    const claim = await this.prisma.walletTransaction.updateMany({
      where: { id: transactionId, status: WalletTransactionStatus.PENDING },
      data: {
        status: succeeded
          ? WalletTransactionStatus.COMPLETED
          : WalletTransactionStatus.FAILED,
      },
    });
    if (claim.count === 0 || !succeeded) return;

    await this.ledgerService.post({
      debitCode: ACCOUNT_CODES.BANK_ACCOUNTS,
      creditCode: ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY,
      amount: transaction.amount,
      currency: transaction.currency,
      reference: transaction.reference,
      description: transaction.description,
      sourceModule: 'WALLET',
      sourceId: transaction.id,
    });

    await this.notificationsService.sendWalletUpdate(
      transaction.wallet.customer.identity.email,
      transaction.wallet.customer.identityId,
      {
        type: 'DEPOSIT',
        amount: transaction.amount,
        currency: transaction.currency,
        description: transaction.description,
      },
    );

    await this.auditService.record({
      identityId: transaction.wallet.customer.identityId,
      action: 'wallet.deposit.completed',
      entityType: 'Wallet',
      entityId: transaction.walletId,
      metadata: {
        amount: transaction.amount,
        reference: transaction.reference,
      },
    });
  }

  /**
   * Pays some or all of an invoice's outstanding balance from the
   * customer's own wallet. Both the debit and the resulting Payment row are
   * created inside one DB transaction — a wallet payment can never leave
   * the ledger and the invoice out of sync with each other.
   */
  async payInvoiceWithWallet(
    customerId: string,
    invoiceId: string,
    amount: number,
  ) {
    const wallet = await this.getOrCreateWallet(customerId);
    const balance = await this.computeBalance(wallet.id);
    if (amount > balance) {
      throw new BadRequestException(
        `Wallet balance (${balance}) is less than the requested payment (${amount})`,
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.customerId !== customerId) {
      throw new ForbiddenException(
        'This invoice does not belong to this customer',
      );
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new ConflictException('Cannot pay a voided invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('This invoice is already fully paid');
    }
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const outstanding = invoice.totalAmount - totalPaid;
    if (amount > outstanding) {
      throw new BadRequestException(
        `Payment amount (${amount}) exceeds the outstanding balance (${outstanding})`,
      );
    }

    const reference = generateWalletReference('WPAY');

    const walletPayment = await this.prisma.$transaction(async (tx) => {
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.PAYMENT,
          status: WalletTransactionStatus.COMPLETED,
          amount: -amount,
          currency: wallet.currency,
          description: `Payment towards invoice ${invoice.invoiceNumber}`,
          reference,
          invoiceId: invoice.id,
        },
      });
      return tx.payment.create({
        data: {
          paymentReference: reference,
          invoiceId: invoice.id,
          amount,
          method: PaymentMethod.WALLET,
          note: 'Paid from wallet balance',
        },
      });
    });

    // Clears the wallet liability into recognized revenue — no separate
    // Cash/Bank movement, since the money already sat inside the wallet
    // liability from an earlier deposit (see finalizeDeposit's own entry).
    await this.financePostingService.postRevenueForPayment(
      walletPayment,
      invoice,
    );

    const updatedInvoice =
      await this.invoicesService.recomputeStatus(invoiceId);

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      const newTotalPaid = totalPaid + amount;
      await this.notificationsService.sendPaymentReceipt(
        customer.identity.email,
        {
          invoiceNumber: invoice.invoiceNumber,
          amount,
          balance: invoice.totalAmount - newTotalPaid,
          currency: invoice.currency,
        },
      );
    }

    await this.auditService.record({
      identityId: customer?.identity.id,
      action: 'wallet.payment.completed',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { amount, reference },
    });

    await this.incentivesService.applyForInvoicePayment(invoiceId, amount);

    return updatedInvoice;
  }

  /** Finance-recorded manual top-up (bank transfer/cash into the wallet) — immediate, always audited. */
  async creditManual(
    customerId: string,
    amount: number,
    description: string | undefined,
    staffId: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    const wallet = await this.getOrCreateWallet(customerId);
    const reference = generateWalletReference('WMDEP');

    const walletTx = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.COMPLETED,
        amount,
        currency: wallet.currency,
        description: description ?? 'Manual wallet credit',
        reference,
        createdByStaffId: staffId,
      },
    });
    await this.ledgerService.post({
      debitCode: ACCOUNT_CODES.BANK_ACCOUNTS,
      creditCode: ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY,
      amount,
      currency: wallet.currency,
      reference,
      description: walletTx.description,
      sourceModule: 'WALLET',
      sourceId: walletTx.id,
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: true },
    });
    if (customer) {
      await this.notificationsService.sendWalletUpdate(
        customer.identity.email,
        customer.identityId,
        {
          type: 'DEPOSIT',
          amount,
          currency: wallet.currency,
          description: description ?? 'Manual wallet credit',
        },
      );
    }

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'wallet.credited',
      entityType: 'Wallet',
      entityId: wallet.id,
      metadata: { amount, reference, staffId, customerId },
    });

    return this.getWalletWithBalance(customerId);
  }

  /** Signed correction (refund/withdrawal/adjustment) by Finance — always audited. */
  async adjust(
    customerId: string,
    amount: number,
    type: WalletTransactionType,
    description: string,
    staffId: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    const wallet = await this.getOrCreateWallet(customerId);
    if (amount < 0) {
      const balance = await this.computeBalance(wallet.id);
      if (balance + amount < 0) {
        throw new BadRequestException(
          `This adjustment would take the wallet balance negative (current balance: ${balance})`,
        );
      }
    }

    const reference = generateWalletReference('WADJ');
    const adjustmentTx = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        status: WalletTransactionStatus.COMPLETED,
        amount,
        currency: wallet.currency,
        description,
        reference,
        createdByStaffId: staffId,
      },
    });

    if (type === WalletTransactionType.REFUND && amount > 0) {
      // A real company loss, not just a liability shuffle — same Refund
      // Losses treatment as a flight/hotel refund (see FinancePostingService.postRefund).
      await this.financePostingService.postRefund({
        amount,
        currency: wallet.currency,
        reference,
        description,
        sourceModule: 'WALLET',
        sourceId: adjustmentTx.id,
        toWallet: true,
      });
    } else if (amount !== 0) {
      const inflow = amount > 0;
      await this.ledgerService.post({
        debitCode: inflow
          ? ACCOUNT_CODES.BANK_ACCOUNTS
          : ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY,
        creditCode: inflow
          ? ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY
          : ACCOUNT_CODES.BANK_ACCOUNTS,
        amount: Math.abs(amount),
        currency: wallet.currency,
        reference,
        description,
        sourceModule: 'WALLET',
        sourceId: adjustmentTx.id,
      });
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: true },
    });
    if (customer) {
      await this.notificationsService.sendWalletUpdate(
        customer.identity.email,
        customer.identityId,
        {
          type: amount >= 0 ? 'DEPOSIT' : 'DEBIT',
          amount: Math.abs(amount),
          currency: wallet.currency,
          description,
        },
      );
    }

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'wallet.adjusted',
      entityType: 'Wallet',
      entityId: wallet.id,
      metadata: { amount, type, reference, staffId, customerId },
    });

    return this.getWalletWithBalance(customerId);
  }

  /**
   * Finance-authorized transfer of funds from one customer's wallet
   * balance to another's — the "Transfers where authorized" requirement.
   * Both legs (TRANSFER_OUT on the source, TRANSFER_IN on the
   * destination) are written inside one DB transaction, sharing a common
   * reference prefix so they're recognizable as one transfer in either
   * wallet's history, exactly like payInvoiceWithWallet keeps its debit
   * and the resulting Payment row atomically in sync.
   *
   * No general-ledger entry is posted: the aggregate Customer Wallet
   * Liability account doesn't fragment by customer, so moving a balance
   * between two customers' wallets is a net-zero change to it — nothing
   * for the ledger to record. WalletTransaction remains the durable
   * per-customer record of the transfer (see Wallet's doc comment in
   * schema.prisma).
   */
  async transferBetweenWallets(
    fromCustomerId: string,
    toCustomerId: string,
    amount: number,
    description: string,
    staffId: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    if (fromCustomerId === toCustomerId) {
      throw new BadRequestException(
        'Cannot transfer a wallet balance to the same customer',
      );
    }

    const fromWallet = await this.getOrCreateWallet(fromCustomerId);
    const toWallet = await this.getOrCreateWallet(toCustomerId);
    const fromBalance = await this.computeBalance(fromWallet.id);
    if (amount > fromBalance) {
      throw new BadRequestException(
        `Source wallet balance (${fromBalance}) is less than the requested transfer (${amount})`,
      );
    }

    const batchReference = generateWalletReference('WTRF');
    await this.prisma.$transaction([
      this.prisma.walletTransaction.create({
        data: {
          walletId: fromWallet.id,
          type: WalletTransactionType.TRANSFER_OUT,
          status: WalletTransactionStatus.COMPLETED,
          amount: -amount,
          currency: fromWallet.currency,
          description: `Transfer to ${toCustomerId}: ${description}`,
          reference: `${batchReference}-OUT`,
          createdByStaffId: staffId,
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: toWallet.id,
          type: WalletTransactionType.TRANSFER_IN,
          status: WalletTransactionStatus.COMPLETED,
          amount,
          currency: toWallet.currency,
          description: `Transfer from ${fromCustomerId}: ${description}`,
          reference: `${batchReference}-IN`,
          createdByStaffId: staffId,
        },
      }),
    ]);

    const [fromCustomer, toCustomer] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: fromCustomerId },
        include: { identity: true },
      }),
      this.prisma.customer.findUnique({
        where: { id: toCustomerId },
        include: { identity: true },
      }),
    ]);
    if (fromCustomer) {
      await this.notificationsService.sendWalletUpdate(
        fromCustomer.identity.email,
        fromCustomer.identityId,
        { type: 'DEBIT', amount, currency: fromWallet.currency, description },
      );
    }
    if (toCustomer) {
      await this.notificationsService.sendWalletUpdate(
        toCustomer.identity.email,
        toCustomer.identityId,
        { type: 'DEPOSIT', amount, currency: toWallet.currency, description },
      );
    }

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'wallet.transferred',
      entityType: 'Wallet',
      entityId: fromWallet.id,
      metadata: {
        fromCustomerId,
        toCustomerId,
        amount,
        reference: batchReference,
        staffId,
      },
    });

    return {
      from: await this.getWalletWithBalance(fromCustomerId),
      to: await this.getWalletWithBalance(toCustomerId),
    };
  }
}
