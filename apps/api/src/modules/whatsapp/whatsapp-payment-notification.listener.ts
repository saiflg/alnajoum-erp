import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { InvoicePaymentSucceededEvent } from '../payments/payments.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';

/**
 * Closes the loop for a payment-link customer who never returns to any
 * browser after paying (the normal case for a link sent over WhatsApp) —
 * pushes a confirmation the moment PaymentsService actually finalizes the
 * payment, regardless of whether that happened via a Paystack webhook, the
 * browser-return path, or PaymentIntentReconciliationService's poller.
 * Listens rather than being called directly so PaymentsModule never has to
 * import WhatsAppModule — see app.module.ts's EventEmitterModule.forRoot()
 * comment. Best-effort and silent by design: a customer who never linked
 * WhatsApp, never opted in, or has no verified number simply gets no
 * message here — they already got the usual email receipt from
 * PaymentsService itself.
 */
@Injectable()
export class WhatsAppPaymentNotificationListener {
  private readonly logger = new Logger(
    WhatsAppPaymentNotificationListener.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: WhatsAppConversationsService,
  ) {}

  @OnEvent('invoice.payment.succeeded')
  async handlePaymentSucceeded(event: InvoicePaymentSucceededEvent) {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: event.customerId },
        select: { companyId: true, whatsapp: true },
      });
      if (!customer?.whatsapp) return;

      const invoice = await this.prisma.invoice.findUnique({
        where: { id: event.invoiceId },
        select: { invoiceNumber: true },
      });
      const label = invoice?.invoiceNumber ?? event.invoiceId;

      await this.conversationsService.sendAutomatedMessage(
        customer.companyId,
        customer.whatsapp,
        `✅ Payment received — ${event.currency} ${event.amount.toLocaleString()} for invoice ${label}. Thank you!`,
        `payment-confirmed:${event.invoiceId}`,
        event.customerId,
      );
    } catch (error) {
      // Never let a notification failure look like a payment problem —
      // the payment itself already succeeded and was committed before
      // this listener ever runs.
      this.logger.warn(
        `Failed to send WhatsApp payment confirmation for invoice ${event.invoiceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
