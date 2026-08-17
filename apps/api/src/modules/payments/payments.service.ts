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
import {
  InvoiceStatus,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentMethod,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { InvoicesService } from './invoices.service';
import {
  PAYMENT_PROVIDER,
  VerifyCheckoutResult,
} from './providers/payment-provider.port';
import type { PaymentProviderPort } from './providers/payment-provider.port';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
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

    await this.prisma.payment.create({
      data: {
        paymentReference: generatePaymentReference(),
        invoiceId,
        amount: dto.amount,
        method: dto.method,
        note: dto.note,
        recordedByStaffId: staffId,
      },
    });

    const updatedInvoice =
      await this.invoicesService.recomputeStatus(invoiceId);

    const customer = await this.prisma.customer.findUnique({
      where: { id: invoice.customerId },
      include: { identity: { select: { email: true } } },
    });
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

    const providerName = this.configService.get<string>(
      'PAYMENT_PROVIDER',
      'mock',
    );
    const reference = generateCheckoutReference();

    const intent = await this.prisma.paymentIntent.create({
      data: {
        invoiceId,
        customerId,
        reference,
        provider: providerName,
        amount: balance,
        currency: invoice.currency,
        status: PaymentIntentStatus.PENDING,
      },
    });

    const webOrigin = this.configService.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    const callbackUrl = `${webOrigin}/portal/invoices/${invoiceId}?checkout_reference=${reference}`;

    const result = await this.paymentProvider.initiateCheckout({
      reference,
      amount: balance,
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

    const result = await this.paymentProvider.verifyCheckout(reference);
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

  private async finalizeIntent(
    intent: PaymentIntent,
    result: VerifyCheckoutResult,
  ): Promise<FinalizeResult> {
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return { ok: true };
    }

    if (!result.success) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      return { ok: false, reason: 'The payment was not successful.' };
    }

    // Defense in depth: only cross-checked when the provider actually
    // reports an amount. The mock provider deliberately doesn't (see its
    // own comment) — a real gateway always does.
    if (result.amount > 0 && result.amount !== intent.amount) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      return {
        ok: false,
        reason: 'The confirmed amount did not match the expected amount.',
      };
    }

    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentIntentStatus.SUCCEEDED },
    });

    await this.prisma.payment.create({
      data: {
        paymentReference: intent.reference,
        invoiceId: intent.invoiceId,
        amount: intent.amount,
        method: PaymentMethod.ONLINE,
        note: `Paid online via ${intent.provider}`,
        recordedByStaffId: null,
      },
    });

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
          amount: intent.amount,
          balance: updatedInvoice.totalAmount - totalPaidNow,
          currency: updatedInvoice.currency,
        },
      );
    }

    return { ok: true };
  }
}
