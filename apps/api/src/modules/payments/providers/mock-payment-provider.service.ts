import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InitiateCheckoutInput,
  InitiateCheckoutResult,
  PaymentProviderPort,
  VerifyCheckoutResult,
} from './payment-provider.port';

/**
 * Always succeeds, no real gateway involved — mirrors
 * MockNotificationProviderService. Sends the customer to a real page in the
 * web app (/checkout/mock) that mimics a hosted checkout screen with a
 * single "Simulate successful payment" action, so the whole redirect-out/
 * redirect-back flow is genuinely exercisable end to end without any
 * vendor account.
 *
 * verifyCheckout() deliberately doesn't echo back a real amount/currency —
 * it has no independent state to verify against, unlike a real gateway.
 * PaymentsService treats amount 0 here as "not independently verified" and
 * trusts its own PaymentIntent record instead of cross-checking, which is
 * exactly the defense-in-depth check a real provider (Paystack) exists to
 * satisfy.
 */
@Injectable()
export class MockPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(MockPaymentProviderService.name);

  constructor(private readonly configService: ConfigService) {}

  initiateCheckout(
    input: InitiateCheckoutInput,
  ): Promise<InitiateCheckoutResult> {
    const webOrigin = this.configService.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    const url = new URL('/checkout/mock', webOrigin);
    url.searchParams.set('reference', input.reference);
    url.searchParams.set('amount', String(input.amount));
    url.searchParams.set('currency', input.currency);
    url.searchParams.set('callback', input.callbackUrl);

    this.logger.log(
      `Mock checkout initiated: ${input.reference} for ${input.currency} ${input.amount}`,
    );

    return Promise.resolve({
      authorizationUrl: url.toString(),
      reference: input.reference,
    });
  }

  verifyCheckout(reference: string): Promise<VerifyCheckoutResult> {
    this.logger.log(`Mock checkout verified (always succeeds): ${reference}`);
    return Promise.resolve({
      reference,
      success: true,
      amount: 0,
      currency: '',
    });
  }
}
