import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InvoiceStatus,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentMethod,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  invoiceStanding,
  lockAndAssertPayable,
  lockInvoice,
} from '../../common/db/payment-guards';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ACCOUNT_CODES } from '../finance/constants/account-codes.constant';
import { FinancePostingService } from '../finance/finance-posting.service';
import { LedgerService } from '../finance/ledger.service';
import { IncentivesService } from '../incentives/incentives.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from './invoices.service';
import {
  PAYMENT_PROVIDER,
  VerifyCheckoutResult,
} from './providers/payment-provider.port';
import type { PaymentProviderPort } from './providers/payment-provider.port';
import { PaymentProviderRouter } from './providers/payment-provider.router';

/** Payload for the 'invoice.payment.succeeded' event — emitted once per
 * finalized payment, after the Invoice/Payment rows are committed.
 * Listened to by WhatsAppPaymentNotificationListener (in the WhatsApp
 * module) to push a confirmation message, without PaymentsModule ever
 * importing WhatsAppModule — see EventEmitterModule.forRoot()'s comment
 * in app.module.ts for why this indirection exists. */
export interface InvoicePaymentSucceededEvent {
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
}

function generatePaymentReference(): string {
  return `PAY-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function generateCheckoutReference(): string {
  return `CHK-${randomBytes(6).toString('hex').toUpperCase()}`;
}

interface FinalizeResult {
  ok: boolean;
  reason?: string;
}

/** A PENDING checkout younger than this blocks a second one on the same invoice (see initiateCheckout). */
const CHECKOUT_IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly incentivesService: IncentivesService,
    private readonly financePostingService: FinancePostingService,
    private readonly integrationsService: IntegrationsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly paymentProviderRouter: PaymentProviderRouter,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
    private readonly ledgerService: LedgerService,
  ) {}

  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    staffId?: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new ConflictException(
        'Cannot record a payment against a voided invoice',
      );
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('This invoice is already fully paid');
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = invoice.totalAmount - totalPaid;
    if (dto.amount > balance) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds the outstanding balance (${balance})`,
      );
    }

    // The checks above give a fast, friendly error; this is the authoritative one. Under the invoice
    // lock the outstanding balance is re-read, so two simultaneous payments cannot both fit.
    const payment = await this.prisma.$transaction(async (tx) => {
      await lockAndAssertPayable(tx, invoiceId, dto.amount);
      return tx.payment.create({
        data: {
          paymentReference: generatePaymentReference(),
          invoiceId,
          amount: dto.amount,
          method: dto.method,
          note: dto.note,
          recordedByStaffId: staffId,
        },
      });
    });

    await this.financePostingService.postRevenueForPayment(payment, invoice);

    const updatedInvoice =
      await this.invoicesService.recomputeStatus(invoiceId);

    // Corporate travel invoices have no customerId (billed to a
    // CorporateAccount instead — see Invoice.customerId's comment in
    // schema.prisma), so there's no customer to email a receipt to.
    const customer = invoice.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: invoice.customerId },
          include: { identity: { select: { email: true } } },
        })
      : null;
    if (customer) {
      const newBalance = invoice.totalAmount - (totalPaid + dto.amount);
      await this.notificationsService.sendPaymentReceipt(
        customer.identity.email,
        {
          invoiceNumber: invoice.invoiceNumber,
          amount: dto.amount,
          balance: newBalance,
          currency: invoice.currency,
        },
      );
    }

    await this.incentivesService.applyForInvoicePayment(invoiceId, dto.amount);

    return updatedInvoice;
  }

  /**
   * Starts a customer-initiated online checkout for the outstanding
   * balance of one of their own invoices. Creates a PENDING PaymentIntent
   * before ever contacting the provider, so a reference exists to
   * reconcile against even if the provider call itself fails or the
   * customer never comes back.
   */
  async initiateCheckout(customerId: string, invoiceId: string) {
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
    const balance = invoice.totalAmount - totalPaid;
    if (balance <= 0) {
      throw new ConflictException('This invoice has no outstanding balance');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true } } },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    // Must match whatever PaymentProviderRouter.resolve() will actually
    // use for the initiateCheckout call below — previously this read
    // only the env var, drifting from the DB-driven /admin/integrations
    // setting the router itself checks first, so a PaymentIntent could
    // record the wrong provider name whenever an admin had activated one
    // via the UI rather than the env var. Reconciliation (anything that
    // looks up a provider by `PaymentIntent.provider`, e.g. the
    // WhatsApp-payment-link poller) depends on this being accurate.
    const providerName =
      (await this.integrationsService.getActiveProvider('PAYMENT')) ??
      this.configService.get<string>('PAYMENT_PROVIDER', 'mock');
    const reference = generateCheckoutReference();

    // Refuse (503) before any intent is written if this provider is not allowed to run here,
    // e.g. the mock provider in production.
    this.paymentProviderRouter.resolveByName(providerName);

    // One live checkout per invoice. Without this, a double click, two browser tabs or a retry each
    // create a full-balance intent and every one of them can settle, taking the customer's money
    // twice. The check and the insert run under the invoice lock so concurrent requests queue up,
    // and the balance is read again inside the lock because a payment may have landed meanwhile.
    const intent = await this.prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const standing = await invoiceStanding(tx, invoiceId);
      if (
        standing.status === InvoiceStatus.VOID ||
        standing.status === InvoiceStatus.PAID ||
        standing.outstanding <= 0
      ) {
        throw new ConflictException('This invoice has no outstanding balance');
      }
      const inProgress = await tx.paymentIntent.findFirst({
        where: {
          invoiceId,
          status: PaymentIntentStatus.PENDING,
          createdAt: {
            gt: new Date(Date.now() - CHECKOUT_IN_PROGRESS_WINDOW_MS),
          },
        },
        select: { id: true },
      });
      if (inProgress) {
        throw new ConflictException(
          'A payment for this invoice is already in progress. Complete it, or wait a few minutes before starting another.',
        );
      }
      return tx.paymentIntent.create({
        data: {
          invoiceId,
          customerId,
          reference,
          provider: providerName,
          amount: standing.outstanding,
          currency: invoice.currency,
          status: PaymentIntentStatus.PENDING,
        },
      });
    });

    const webOrigin = this.configService.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    const callbackUrl = `${webOrigin}/portal/invoices/${invoiceId}?checkout_reference=${reference}`;

    const result = await this.paymentProvider.initiateCheckout({
      reference,
      amount: intent.amount,
      currency: invoice.currency,
      customerEmail: customer.identity.email,
      callbackUrl,
    });

    return {
      authorizationUrl: result.authorizationUrl,
      reference: intent.reference,
    };
  }

  /** Customer-facing verification — called when the browser returns from
   * the provider's hosted checkout page. Throws on failure/mismatch so the
   * controller can surface a clear error. */
  async verifyCheckout(
    customerId: string,
    invoiceId: string,
    reference: string,
  ) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { reference },
    });
    if (!intent) {
      throw new NotFoundException('No checkout found for this reference');
    }
    if (intent.customerId !== customerId) {
      throw new ForbiddenException(
        'This checkout does not belong to this customer',
      );
    }
    if (intent.invoiceId !== invoiceId) {
      throw new BadRequestException(
        'This checkout reference does not match this invoice',
      );
    }

    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return this.invoicesService.getInvoice(intent.invoiceId, customerId);
    }

    // Verify with the provider that issued this intent, not whichever is active now.
    const result = await this.paymentProviderRouter
      .resolveByName(intent.provider)
      .verifyCheckout(reference);
    const outcome = await this.finalizeIntent(intent, result);
    if (!outcome.ok) {
      throw new ConflictException(
        outcome.reason ?? 'This payment could not be confirmed.',
      );
    }
    return this.invoicesService.getInvoice(intent.invoiceId, customerId);
  }

  /**
   * Webhook-facing finalization — never throws, so a legitimately failed
   * or already-processed payment doesn't make Paystack retry the webhook
   * forever. Silently ignores references we don't recognize (a webhook
   * for another integration hitting the wrong URL, replay after a DB
   * reset in a non-production environment, etc.).
   */
  async handleProviderWebhookEvent(
    reference: string,
    result: VerifyCheckoutResult,
  ) {
    // Wallet top-ups share the provider and the webhook endpoint but are not invoice intents; hand them
    // to the wallet (decoupled by an event, since the wallet module itself depends on payments).
    if (reference.startsWith('WDEP-')) {
      this.eventEmitter.emit('wallet.deposit.webhook', { reference, result });
      return;
    }
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { reference },
    });
    if (!intent) {
      this.logger.warn(`Webhook for unknown checkout reference: ${reference}`);
      return;
    }
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return; // already finalized via the customer-facing verify path
    }
    const outcome = await this.finalizeIntent(intent, result);
    if (!outcome.ok) {
      this.logger.warn(
        `Webhook finalize failed for ${reference}: ${outcome.reason}`,
      );
    }
  }

  /**
   * Poller-facing reconciliation — for a provider with no reliable
   * webhook (OPay) or a customer who never returns to the browser after
   * paying (the common case for a link sent over WhatsApp), this is the
   * only path that will ever notice a payment succeeded. Verifies against
   * whichever provider actually issued this specific intent
   * (`intent.provider`), not whatever is active now. Never throws, same
   * "one bad intent doesn't stop the batch" contract as the webhook path
   * — used by PaymentIntentReconciliationService in a loop.
   */
  async reconcilePendingIntent(intentId: string): Promise<FinalizeResult> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!intent) {
      return { ok: false, reason: 'Payment intent not found' };
    }
    if (intent.status !== PaymentIntentStatus.PENDING) {
      return { ok: true };
    }
    const provider = this.paymentProviderRouter.resolveByName(intent.provider);
    const result = await provider.verifyCheckout(intent.reference);
    return this.finalizeIntent(intent, result);
  }

  private async finalizeIntent(
    intent: PaymentIntent,
    result: VerifyCheckoutResult,
  ): Promise<FinalizeResult> {
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return { ok: true };
    }

    if (!result.success) {
      // Not paid *yet* (abandoned checkout still open, processing…): keep the intent PENDING so a
      // later charge.success webhook or reconciliation can still credit it. Only a definitive
      // failure is final.
      if (result.pending) {
        return {
          ok: false,
          reason: 'The payment is still pending with the provider.',
        };
      }
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      return { ok: false, reason: 'The payment was not successful.' };
    }

    // The mock provider has nothing independent to report (amount 0); a real gateway must confirm
    // the exact amount and currency. A mismatch is NOT credited, but the intent stays PENDING and
    // is logged loudly — failing it permanently would lose a real payment that needs a human.
    if (!result.simulated) {
      const amountOk = result.amount > 0 && result.amount === intent.amount;
      const currencyOk =
        !result.currency ||
        result.currency.toUpperCase() === intent.currency.toUpperCase();
      if (!amountOk || !currencyOk) {
        this.logger.error(
          `Provider confirmed ${result.reference} as paid but amount/currency do not match intent ` +
            `(expected ${intent.amount} ${intent.currency}, got ${result.amount} ${result.currency}); ` +
            'not crediting — needs manual review.',
        );
        return {
          ok: false,
          reason: 'The confirmed amount did not match the expected amount.',
        };
      }
    }

    // Atomically claims the PENDING -> SUCCEEDED transition, gated on
    // still being PENDING. This is what makes two concurrent verify calls
    // for the same intent safe — a real possibility: React Strict Mode
    // double-invokes effects in dev, and a network retry or a user
    // double-click before the button disables can do the same in
    // production. Without this, both calls can read PENDING before either
    // writes (the `intent` passed in is a snapshot from before this
    // method ran) and both go on to create a Payment row below — the
    // paymentReference unique constraint would reject the second insert,
    // but only after doing real work and surfacing as an unhandled error
    // instead of a clean, silent no-op. Only the caller whose update
    // actually changes a row (count 1) proceeds.
    //
    // The claim and the Payment row are written in ONE transaction, under the invoice lock: a crash
    // can no longer leave an intent marked SUCCEEDED with no payment recorded (the money taken and
    // nothing to show for it), and the surplus check below sees a consistent balance.
    const recorded = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: PaymentIntentStatus.PENDING },
        data: { status: PaymentIntentStatus.SUCCEEDED },
      });
      if (claim.count === 0) {
        return null;
      }
      await lockInvoice(tx, intent.invoiceId);
      const standing = await invoiceStanding(tx, intent.invoiceId);

      // The customer has really paid, so every naira is accounted for - but it must not push the
      // invoice past its total. The part that settles the invoice becomes the Payment; any surplus (the
      // invoice was settled another way or voided while this checkout was open, e.g. an abandoned
      // checkout that completes late) is credited to the customer's own wallet as credit on account, in
      // this same transaction, with its own ledger entry. Finance can refund it from there.
      const open =
        standing.status === InvoiceStatus.VOID
          ? 0
          : Math.max(standing.outstanding, 0);
      const applied = Math.min(intent.amount, open);
      const surplus = intent.amount - applied;

      const payment =
        applied > 0
          ? await tx.payment.create({
              data: {
                paymentReference: intent.reference,
                invoiceId: intent.invoiceId,
                amount: applied,
                method: PaymentMethod.ONLINE,
                note: `Paid online via ${intent.provider}`,
                recordedByStaffId: null,
              },
            })
          : null;

      if (surplus > 0) {
        const holder = await tx.customer.findUniqueOrThrow({
          where: { id: intent.customerId },
          select: { companyId: true },
        });
        const wallet = await tx.wallet.upsert({
          where: { customerId: intent.customerId },
          create: { customerId: intent.customerId, currency: intent.currency },
          update: {},
        });
        const credit = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.DEPOSIT,
            status: WalletTransactionStatus.COMPLETED,
            amount: surplus,
            currency: intent.currency,
            description: `Surplus from online payment ${intent.reference}: the invoice was already ${
              standing.status === InvoiceStatus.VOID ? 'voided' : 'settled'
            }`,
            reference: `SURPLUS-${intent.reference}`,
            invoiceId: intent.invoiceId,
          },
        });
        await this.ledgerService.post(
          {
            debitCode: ACCOUNT_CODES.BANK_ACCOUNTS,
            creditCode: ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY,
            amount: surplus,
            currency: intent.currency,
            reference: credit.reference,
            description: credit.description,
            sourceModule: 'WALLET',
            sourceId: credit.id,
            companyId: holder.companyId,
          },
          tx,
        );
      }
      return { payment, standing, applied, surplus };
    });
    if (!recorded) {
      return { ok: true };
    }
    if (recorded.surplus > 0) {
      this.logger.warn(
        `Online payment ${intent.reference} landed on invoice ${intent.invoiceId} (${recorded.standing.status}, ` +
          `${recorded.standing.outstanding} outstanding): ${recorded.applied} applied, ` +
          `${recorded.surplus} ${intent.currency} credited to the customer's wallet.`,
      );
    }

    if (recorded.payment) {
      const invoiceForLedger = await this.prisma.invoice.findUniqueOrThrow({
        where: { id: intent.invoiceId },
      });
      await this.financePostingService.postRevenueForPayment(
        recorded.payment,
        invoiceForLedger,
      );
    }

    const updatedInvoice = await this.invoicesService.recomputeStatus(
      intent.invoiceId,
    );

    const customer = await this.prisma.customer.findUnique({
      where: { id: intent.customerId },
      include: { identity: { select: { email: true } } },
    });
    if (customer) {
      const totalPaidNow = updatedInvoice.payments.reduce(
        (sum, p) => sum + p.amount,
        0,
      );
      await this.notificationsService.sendPaymentReceipt(
        customer.identity.email,
        {
          invoiceNumber: updatedInvoice.invoiceNumber,
          amount: recorded.applied,
          balance: Math.max(updatedInvoice.totalAmount - totalPaidNow, 0),
          currency: updatedInvoice.currency,
        },
      );
    }

    if (recorded.applied > 0) {
      await this.incentivesService.applyForInvoicePayment(
        intent.invoiceId,
        recorded.applied,
      );
    }

    this.eventEmitter.emit('invoice.payment.succeeded', {
      invoiceId: intent.invoiceId,
      customerId: intent.customerId,
      amount: intent.amount,
      currency: intent.currency,
    } satisfies InvoicePaymentSucceededEvent);

    return { ok: true };
  }
}
