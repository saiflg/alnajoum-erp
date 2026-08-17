import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InitiateCheckoutInput,
  InitiateCheckoutResult,
  PaymentProviderPort,
  VerifyCheckoutResult,
} from './payment-provider.port';

interface OpayCreateOrderResponse {
  code: string;
  message: string;
  data?: {
    reference: string;
    orderNo: string;
    status: string;
    cashierUrl: string;
  };
}

interface OpayQueryOrderResponse {
  code: string;
  message: string;
  data?: {
    reference: string;
    orderNo: string;
    // INITIAL | PENDING | SUCCESS | FAIL | CLOSE, per OPay's documented
    // order lifecycle.
    status: string;
    amount: { total: number; currency: string };
  };
}

const OPAY_SUCCESS_CODE = '00000';

/**
 * Implementation against OPay's Cashier (merchant checkout) API
 * (https://documentation.opaycheckout.com — "Create Order" and "Query
 * Order Status" endpoints), for Nigerian merchants who want OPay wallet /
 * bank card / USSD checkout alongside Paystack.
 *
 * Confidence note, more cautious than the one on
 * PaystackPaymentProviderService: OPay's Cashier API is real and this is
 * built directly from its public documentation (request/response shapes,
 * the `code: "00000"` success sentinel, amounts in kobo under
 * `amount.total`), but it is meaningfully less battle-tested in general
 * circulation than Paystack's API, and — same root cause as
 * Paystack — has not been run against a real OPay merchant account in
 * this environment (that needs a merchant account only the business
 * owner can create, via https://merchant.opayweb.com). Treat the exact
 * field names here as "implemented to the best of the documented
 * contract, not independently confirmed" and re-check them against
 * OPay's current docs before a real test-mode transaction.
 *
 * Deliberately scoped to checkout + status polling only, not a webhook —
 * unlike Paystack's HMAC-SHA512-over-the-raw-body scheme (simple, and one
 * I have high confidence in), OPay's callback signature transport isn't
 * something reproduced here with the same confidence, and shipping a
 * webhook signature check that looks plausible but silently doesn't
 * verify anything correctly is worse than not shipping one — a forged
 * callback could fake a payment success. Until that's confirmed against
 * OPay's current docs, `PaymentsService.verifyCheckout` (the
 * customer-facing return path, which polls this provider's
 * `verifyCheckout` directly rather than trusting an inbound payload) is
 * the only confirmation path for OPay payments.
 */
@Injectable()
export class OpayPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(OpayPaymentProviderService.name);
  private readonly baseUrl = 'https://liveapi.opaycheckout.com';

  constructor(private readonly configService: ConfigService) {}

  private getSecretKey(): string {
    const key = this.configService.get<string>('OPAY_SECRET_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'PAYMENT_PROVIDER=opay but OPAY_SECRET_KEY is not set.',
      );
    }
    return key;
  }

  private getMerchantId(): string {
    const id = this.configService.get<string>('OPAY_MERCHANT_ID');
    if (!id) {
      throw new ServiceUnavailableException(
        'PAYMENT_PROVIDER=opay but OPAY_MERCHANT_ID is not set.',
      );
    }
    return id;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getSecretKey()}`,
      MerchantId: this.getMerchantId(),
      'Content-Type': 'application/json',
    };
  }

  async initiateCheckout(
    input: InitiateCheckoutInput,
  ): Promise<InitiateCheckoutResult> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/international/cashier/create`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          country: 'NG',
          reference: input.reference,
          // OPay amounts are in the smallest currency unit (kobo for
          // NGN), wrapped in an { total, currency } object rather than a
          // flat field like Paystack.
          amount: {
            total: Math.round(input.amount * 100),
            currency: input.currency,
          },
          returnUrl: input.callbackUrl,
          callbackUrl: input.callbackUrl,
          cancelUrl: input.callbackUrl,
          userInfo: { userEmail: input.customerEmail },
        }),
      },
    );
    const body = (await res.json()) as OpayCreateOrderResponse;

    if (!res.ok || body.code !== OPAY_SUCCESS_CODE || !body.data) {
      this.logger.error(
        `OPay create-order failed for ${input.reference}: ${body.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The payment provider could not start a checkout session. Please try again shortly.',
      );
    }

    return {
      authorizationUrl: body.data.cashierUrl,
      reference: body.data.reference,
    };
  }

  async verifyCheckout(reference: string): Promise<VerifyCheckoutResult> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/international/cashier/status`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ reference }),
      },
    );
    const body = (await res.json()) as OpayQueryOrderResponse;

    if (!res.ok || body.code !== OPAY_SUCCESS_CODE || !body.data) {
      this.logger.error(
        `OPay status query failed for ${reference}: ${body.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The payment provider could not confirm this transaction. Please try again shortly.',
      );
    }

    return {
      reference: body.data.reference,
      success: body.data.status === 'SUCCESS',
      amount: body.data.amount.total / 100,
      currency: body.data.amount.currency,
    };
  }
}
