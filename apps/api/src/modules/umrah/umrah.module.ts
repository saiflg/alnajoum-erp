import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { UmrahPackagesController } from './umrah-packages.controller';
import { UmrahPackagesService } from './umrah-packages.service';
import { UmrahRegistrationsAdminController } from './umrah-registrations-admin.controller';
import { UmrahRegistrationsOwnController } from './umrah-registrations-own.controller';
import { UmrahRegistrationsService } from './umrah-registrations.service';

@Module({
  imports: [CustomersModule, UsersModule, NotificationsModule, PaymentsModule, AuditModule],
  controllers: [
    UmrahPackagesController,
    UmrahRegistrationsOwnController,
    UmrahRegistrationsAdminController,
  ],
  providers: [UmrahPackagesService, UmrahRegistrationsService],
  exports: [UmrahPackagesService, UmrahRegistrationsService],
})
export class UmrahModule {}
