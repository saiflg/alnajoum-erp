import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FeatureFlagGuard } from './common/guards/feature-flag.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchModule } from './modules/branch/branch.module';
import { CompanyModule } from './modules/company/company.module';
import { ContactModule } from './modules/contact/contact.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FlightsModule } from './modules/flights/flights.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { HajjModule } from './modules/hajj/hajj.module';
import { UmrahModule } from './modules/umrah/umrah.module';
import { ManualPaymentsModule } from './modules/manual-payments/manual-payments.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { HotelsModule } from './modules/hotels/hotels.module';
import { VehicleRentalsModule } from './modules/vehicle-rentals/vehicle-rentals.module';
import { VisaModule } from './modules/visa/visa.module';
import { CorporateTravelModule } from './modules/corporate-travel/corporate-travel.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CrmModule } from './modules/crm/crm.module';
import { SupportModule } from './modules/support/support.module';
import { HajjOpsModule } from './modules/hajj-ops/hajj-ops.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DataModule } from './modules/data/data.module';
import { AiModule } from './modules/ai/ai.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    // Global on purpose — the one place two feature modules that must
    // never import each other (Payments, WhatsApp) can still react to
    // one another's domain events. See PaymentsService's
    // 'invoice.payment.succeeded' emit and
    // WhatsAppPaymentNotificationListener for the only current use.
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditModule,
    IntegrationsModule,
    RbacModule,
    AuthModule,
    CompanyModule,
    BranchModule,
    UsersModule,
    CustomersModule,
    NotificationsModule,
    PaymentsModule,
    FlightsModule,
    ContactModule,
    WalletModule,
    HajjModule,
    UmrahModule,
    ManualPaymentsModule,
    RemindersModule,
    HotelsModule,
    VehicleRentalsModule,
    VisaModule,
    CorporateTravelModule,
    FinanceModule,
    CrmModule,
    SupportModule,
    HajjOpsModule,
    GovernanceModule,
    DashboardModule,
    DataModule,
    AiModule,
    WhatsAppModule,
    SuppliersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule {}
