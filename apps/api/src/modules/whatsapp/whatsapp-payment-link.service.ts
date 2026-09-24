import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { FlightsService } from '../flights/flights.service';
import { InvoicesService } from '../payments/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';

/**
 * The "payment links through WhatsApp" item WhatsAppModule's own doc
 * comment previously listed as deferred. Deliberately thin: every actual
 * checkout/verification decision still goes through the existing
 * PaymentsService/PaymentProviderPort — this service only resolves which
 * invoice a customer means and formats the resulting link as a WhatsApp
 * message. It never marks anything paid; only PaymentsService.finalizeIntent
 * (driven by a webhook or PaymentIntentReconciliationService) does that, so
 * a customer claiming "I paid" in chat has no effect here — see spec
 * constraint "never trust 'I paid' claims" from the original Phase 14
 * spec, which applies just as much to this follow-on feature.
 */
@Injectable()
export class WhatsAppPaymentLinkService {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly conversationsService: WhatsAppConversationsService,
  ) {}

  /** Builds a payment-link message for one invoice already known to
   * belong to `customerId` (callers are responsible for that ownership
   * check — see requestLinkForBooking and sendForConversation below, the
   * only two callers). Creates a real PaymentIntent via the same
   * PaymentsService path the customer portal uses — never a bespoke
   * WhatsApp-only checkout. */
  private async buildLinkMessage(
    customerId: string,
    invoiceId: string,
  ): Promise<string> {
    const invoice = await this.invoicesService.getInvoice(
      invoiceId,
      customerId,
    );
    if (invoice.status === InvoiceStatus.PAID) {
      return 'This invoice is already fully paid — no payment link needed.';
    }
    if (invoice.status === InvoiceStatus.VOID) {
      return 'No payment is currently due for this invoice.';
    }
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = invoice.totalAmount - totalPaid;
    if (balance <= 0) {
      return 'This invoice has no outstanding balance.';
    }

    const { authorizationUrl } = await this.paymentsService.initiateCheckout(
      customerId,
      invoiceId,
    );

    return (
      `Here's your secure payment link for invoice ${invoice.invoiceNumber} ` +
      `(${invoice.currency} ${balance.toLocaleString()} due):\n${authorizationUrl}\n\n` +
      "This link is hosted by our payment partner — we'll never ask you to " +
      'pay by sharing your card details or a code directly in this chat.'
    );
  }

  /** Self-service entry point — resolves a booking by reference, scoped
   * to the customer's own bookings (same lookup myBookings() already
   * uses), then the invoice tied to it. Returns text only; the caller
   * (WhatsAppWebhookService) sends it, exactly like every other
   * self-service reply-builder. */
  async requestLinkForBooking(
    customerId: string,
    bookingReference: string,
  ): Promise<string> {
    const bookings = await this.flightsService.listForCustomer(customerId);
    const booking = bookings.find(
      (b) =>
        b.bookingReference.toLowerCase() === bookingReference.toLowerCase(),
    );
    if (!booking) {
      return `We couldn't find a booking with reference "${bookingReference}" on your account. Reply MENU to see your bookings.`;
    }
    const invoice = await this.invoicesService.getInvoiceForFlightBooking(
      booking.id,
    );
    if (!invoice) {
      return `No invoice was found for booking ${booking.bookingReference}. Please contact our staff for assistance.`;
    }
    return this.buildLinkMessage(customerId, invoice.id);
  }

  /** Staff-triggered entry point — sends immediately through the normal
   * staff-reply pipeline (WhatsAppConversationsService.sendReply), so it's
   * attributed, tenant-checked, and stored exactly like a manually-typed
   * reply. */
  async sendForConversation(
    conversationId: string,
    invoiceId: string,
    staffId: string,
    tenantCompanyId?: string,
  ) {
    const conversation = await this.conversationsService.get(
      conversationId,
      tenantCompanyId,
    );
    if (!conversation.customerId) {
      throw new BadRequestException(
        'This conversation is not linked to a verified customer yet.',
      );
    }
    const message = await this.buildLinkMessage(
      conversation.customerId,
      invoiceId,
    );
    return this.conversationsService.sendReply(
      conversationId,
      message,
      staffId,
      tenantCompanyId,
    );
  }
}
