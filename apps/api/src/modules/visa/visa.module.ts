import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { VisaApplicationsAdminController } from './visa-applications-admin.controller';
import { VisaApplicationsOwnController } from './visa-applications-own.controller';
import { VisaService } from './visa.service';

@Module({
  // Order matters: the static "visa/applications/me" routes must be
  // registered before the dynamic "visa/applications/:id" ones.
  imports: [CustomersModule, UsersModule, PaymentsModule, NotificationsModule],
  controllers: [VisaApplicationsOwnController, VisaApplicationsAdminController],
  providers: [VisaService],
  exports: [VisaService],
})
export class VisaModule {}
