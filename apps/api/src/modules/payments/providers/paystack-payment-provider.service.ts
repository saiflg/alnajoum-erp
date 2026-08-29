import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  InitiateCheckoutInput,
  InitiateCheckoutResult,
  PaymentProviderPort,
  VerifyCheckoutResult,
} from './payment-provider.port';

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: {
    reference: string;
    status: 'success' | 'failed' | 'abandoned';
    amount: number; // kobo
    currency: string;
  };
}

/**
 * Real implementation against Paystack's documented REST API
 * (https://paystack.com/docs/api/transaction/) — set PAYMENT_PROVIDER=paystack
 * plus PAYSTACK_SECRET_KEY (and PAYSTACK_WEBHOOK... nothing extra needed;
 * the webhook is verified with the same secret key) to use it. Unlike
 * DuffelFlightProviderService, this isn't a stub: Paystack's API is public,
 * stable, and simple enough (two REST calls plus an HMAC signature check)
 * to implement directly against its documented contract.
 *
 * Honesty note, the same one that applies to Duffel: this has NOT been
 * exercised against a live Paystack account in this environment — doing
 * that requires an account only the business owner can create (even a free
 * test-mode account needs sign-up). The request/response shapes and the
 * webhook signature scheme below are implemented per Paystack's public
 * documentation and covered by a unit test that mocks the HTTP layer to
 * check the request is built correctly and the response is parsed
 * correctly — but a real test-mode transaction should be run before this
 * is trusted in production. Get a test secret key free at
 * https://dashboard.paystack.com (Settings → API Keys & Webhooks).
 */
@Injectable()
export class PaystackPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(PaystackPaymentProviderService.name);
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private async getSecretKey(): Promise<string> {
    const dbConfig = await this.integrationsService.getCredentialConfig(
      'PAYMENT',
      'paystack',
    );
    const key =
      dbConfig?.secretKey || this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'PAYMENT_PROVIDER=paystack but no secret key is configured. Add one at /admin/integrations, or set PAYSTACK_SECRET_KEY.',
      );
    }
    return key;
  }

  async initiateCheckout(
    input: InitiateCheckoutInput,
  ): Promise<InitiateCheckoutResult> {
    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.customerEmail,
        // Paystack amounts are in the smallest currency unit (kobo for NGN).
        amount: Math.round(input.amount * 100),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
      }),
    });
    const body = (await res.json()) as PaystackInitializeResponse;

    if (!res.ok || !body.status || !body.data) {
      this.logger.error(
        `Paystack initialize failed for ${input.reference}: ${body.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The payment provider could not start a checkout session. Please try again shortly.',
      );
    }

    return {
      authorizationUrl: body.data.authorization_url,
      reference: body.data.reference,
    };
  }

  async verifyCheckout(reference: string): Promise<VerifyCheckoutResult> {
    const res = await fetch(
      `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${await this.getSecretKey()}` } },
    );
    const body = (await res.json()) as PaystackVerifyResponse;

    if (!res.ok || !body.status || !body.data) {
      this.logger.error(
        `Paystack verify failed for ${reference}: ${body.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The payment provider could not confirm this transaction. Please try again shortly.',
      );
    }

    return {
      reference: body.data.reference,
      success: body.data.status === 'success',
      amount: body.data.amount / 100,
      currency: body.data.currency,
    };
  }

  /**
   * Paystack signs each webhook request body with HMAC-SHA512, keyed with
   * the same secret key, sent as the `x-paystack-signature` header. Must be
   * computed against the exact raw request bytes (not a re-serialized
   * JSON.stringify of a parsed body, which can differ in whitespace/key
   * order and silently break the comparison) — see bootstrap wiring for
   * the raw-body capture this depends on.
   */
  async verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<boolean> {
    if (!signature) {
      return false;
    }
    const expected = createHmac('sha512', await this.getSecretKey())
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  }
}
