import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { MockPaymentProviderService } from '../payments/providers/mock-payment-provider.service';
import { OpayPaymentProviderService } from '../payments/providers/opay-payment-provider.service';
import { PAYMENT_PROVIDER } from '../payments/providers/payment-provider.port';
import { PaymentProviderRouter } from '../payments/providers/payment-provider.router';
import { PaystackPaymentProviderService } from '../payments/providers/paystack-payment-provider.service';
import { UsersModule } from '../users/users.module';
import { WalletAdminController } from './wallet-admin.controller';
import { WalletOwnController } from './wallet-own.controller';
import { WalletService } from './wallet.service';

@Module({
  // Order matters: the static "wallet/me/..." routes must be registered
  // before the dynamic "wallet/:customerId" ones.
  imports: [
    ConfigModule,
    CustomersModule,
    UsersModule,
    NotificationsModule,
    PaymentsModule,
    AuditModule,
    IncentivesModule,
    IntegrationsModule,
    FinanceModule,
  ],
  controllers: [WalletOwnController, WalletAdminController],
  providers: [
    WalletService,
    // Re-declared here (not just imported from PaymentsModule) because
    // PAYMENT_PROVIDER is a module-local provider there, not exported —
    // same three concrete adapters plus the router that picks between them,
    // same as PaymentsModule.
    MockPaymentProviderService,
    PaystackPaymentProviderService,
    OpayPaymentProviderService,
    PaymentProviderRouter,
    { provide: PAYMENT_PROVIDER, useExisting: PaymentProviderRouter },
  ],
  exports: [WalletService],
})
export class WalletModule {}
