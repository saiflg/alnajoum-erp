import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
