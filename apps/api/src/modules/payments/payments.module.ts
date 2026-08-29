import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CustomersModule } from '../customers/customers.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { IntegrationsModule } from '../integrations/integrations.module';
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
import { PaymentProviderRouter } from './providers/payment-provider.router';
import { PaystackPaymentProviderService } from './providers/paystack-payment-provider.service';
import { ReceiptsService } from './receipts.service';

@Module({
  imports: [
    ConfigModule,
    CustomersModule,
    UsersModule,
    NotificationsModule,
    IncentivesModule,
    IntegrationsModule,
  ],
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
    ReceiptsService,
    MockPaymentProviderService,
    PaystackPaymentProviderService,
    OpayPaymentProviderService,
    PaymentProviderRouter,
    { provide: PAYMENT_PROVIDER, useExisting: PaymentProviderRouter },
  ],
  exports: [InvoicesService],
})
export class PaymentsModule {}
