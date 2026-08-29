import {
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { PaystackPaymentProviderService } from './providers/paystack-payment-provider.service';

interface PaystackWebhookEvent {
  event: string;
  data?: {
    reference: string;
    status: string;
    amount: number; // kobo
    currency: string;
  };
}

/**
 * Public webhook receiver for Paystack's server-to-server payment
 * notifications — the reliable half of confirming a payment, independent
 * of whether the customer's browser ever makes it back to the callback
 * URL (closed tab, lost connection, etc.). Always instantiated (harmless
 * when PAYMENT_PROVIDER=mock — Paystack simply never calls it), but every
 * request is signature-checked against PAYSTACK_SECRET_KEY regardless of
 * which provider is currently active, so a stray request can't forge a
 * payment either way.
 */
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paystackProvider: PaystackPaymentProviderService,
  ) {}

  @Public()
  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    if (
      !req.rawBody ||
      !(await this.paystackProvider.verifyWebhookSignature(req.rawBody, signature))
    ) {
      this.logger.warn('Rejected a Paystack webhook with an invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = req.body as PaystackWebhookEvent;

    // Only "charge.success" is handled — refunds/disputes/other event
    // types aren't modeled yet and are safely ignored (still 200'd, so
    // Paystack doesn't retry them forever).
    if (event.event === 'charge.success' && event.data) {
      await this.paymentsService.handleProviderWebhookEvent(
        event.data.reference,
        {
          reference: event.data.reference,
          success: event.data.status === 'success',
          amount: event.data.amount / 100,
          currency: event.data.currency,
        },
      );
    }

    return { received: true };
  }
}
