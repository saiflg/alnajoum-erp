import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { InvoicesAdminController } from './invoices-admin.controller';
import { InvoicesOwnController } from './invoices-own.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [CustomersModule, UsersModule, NotificationsModule],
  // Order matters: the static "invoices/me" routes must be registered
  // before the dynamic "invoices/:id" ones, otherwise Express would match
  // "me" as an invoice id.
  controllers: [InvoicesOwnController, InvoicesAdminController],
  providers: [InvoicesService, PaymentsService],
  exports: [InvoicesService],
})
export class PaymentsModule {}
