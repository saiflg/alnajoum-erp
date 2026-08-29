import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MockPaymentProviderService } from './mock-payment-provider.service';
import { OpayPaymentProviderService } from './opay-payment-provider.service';
import {
  InitiateCheckoutInput,
  InitiateCheckoutResult,
  PaymentProviderPort,
  VerifyCheckoutResult,
} from './payment-provider.port';
import { PaystackPaymentProviderService } from './paystack-payment-provider.service';

/** Same runtime-switchable pattern as FlightProviderRouter — see its doc
 * comment. Falls back to PAYMENT_PROVIDER when nothing has been activated
 * at /admin/integrations yet. */
@Injectable()
export class PaymentProviderRouter implements PaymentProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockPaymentProviderService,
    private readonly paystackProvider: PaystackPaymentProviderService,
    private readonly opayProvider: OpayPaymentProviderService,
  ) {}

  private async resolve(): Promise<PaymentProviderPort> {
    const active = await this.integrationsService.getActiveProvider('PAYMENT');
    const providerName =
      active ?? this.configService.get<string>('PAYMENT_PROVIDER', 'mock');
    switch (providerName) {
      case 'paystack':
        return this.paystackProvider;
      case 'opay':
        return this.opayProvider;
      default:
        return this.mockProvider;
    }
  }

  async initiateCheckout(
    input: InitiateCheckoutInput,
  ): Promise<InitiateCheckoutResult> {
    return (await this.resolve()).initiateCheckout(input);
  }

  async verifyCheckout(reference: string): Promise<VerifyCheckoutResult> {
    return (await this.resolve()).verifyCheckout(reference);
  }
}
