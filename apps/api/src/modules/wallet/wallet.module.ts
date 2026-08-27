import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { MockPaymentProviderService } from '../payments/providers/mock-payment-provider.service';
import { OpayPaymentProviderService } from '../payments/providers/opay-payment-provider.service';
import { PAYMENT_PROVIDER } from '../payments/providers/payment-provider.port';
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
  ],
  controllers: [WalletOwnController, WalletAdminController],
  providers: [
    WalletService,
    // Re-declared here (not just imported from PaymentsModule) because
    // PAYMENT_PROVIDER is a module-local provider there, not exported —
    // same three concrete adapters, same env-driven selection.
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
  exports: [WalletService],
})
export class WalletModule {}
