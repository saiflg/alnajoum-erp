import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { HajjPackagesController } from './hajj-packages.controller';
import { HajjPackagesService } from './hajj-packages.service';
import { HajjRegistrationsAdminController } from './hajj-registrations-admin.controller';
import { HajjRegistrationsOwnController } from './hajj-registrations-own.controller';
import { HajjRegistrationsService } from './hajj-registrations.service';

@Module({
  imports: [CustomersModule, UsersModule, NotificationsModule, PaymentsModule, AuditModule],
  // Order matters: static "hajj/packages/admin" and "hajj/registrations/me"
  // routes must be registered before the dynamic ":id" ones.
  controllers: [
    HajjPackagesController,
    HajjRegistrationsOwnController,
    HajjRegistrationsAdminController,
  ],
  providers: [HajjPackagesService, HajjRegistrationsService],
  exports: [HajjPackagesService, HajjRegistrationsService],
})
export class HajjModule {}
