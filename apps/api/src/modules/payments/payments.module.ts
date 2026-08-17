import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { InvoicesAdminController } from './invoices-admin.controller';
import { InvoicesOwnController } from './invoices-own.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { MockPaymentProviderService } from './providers/mock-payment-provider.service';
import { OpayPaymentProviderService } from './providers/opay-payment-provider.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.port';
import { PaystackPaymentProviderService } from './providers/paystack-payment-provider.service';

@Module({
  imports: [ConfigModule, CustomersModule, UsersModule, NotificationsModule],
  // Order matters: the static "invoices/me" routes must be registered
  // before the dynamic "invoices/:id" ones, otherwise Express would match
  // "me" as an invoice id.
  controllers: [
    InvoicesOwnController,
    InvoicesAdminController,
    PaystackWebhookController,
  ],
  providers: [
    InvoicesService,
    PaymentsService,
    MockPaymentProviderService,
    PaystackPaymentProviderService,
    OpayPaymentProviderService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [
        ConfigService,
        MockPaymentProviderService,
        PaystackPaymentProviderService,
        OpayPaymentProviderService,
      ],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockPaymentProviderService,
        paystackProvider: PaystackPaymentProviderService,
        opayProvider: OpayPaymentProviderService,
      ) => {
        switch (configService.get<string>('PAYMENT_PROVIDER', 'mock')) {
          case 'paystack':
            return paystackProvider;
          case 'opay':
            return opayProvider;
          default:
            return mockProvider;
        }
      },
    },
  ],
  exports: [InvoicesService],
})
export class PaymentsModule {}
