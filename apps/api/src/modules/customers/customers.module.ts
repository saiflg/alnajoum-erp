import { Module } from '@nestjs/common';
import { CustomerAdminDocumentsController } from './documents/customer-admin-documents.controller';
import { CustomerDocumentsService } from './documents/customer-documents.service';
import { CustomerOwnDocumentsController } from './documents/customer-own-documents.controller';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  // Order matters: the static "customers/me/documents" routes must be
  // registered before the dynamic "customers/:customerId/documents" ones,
  // otherwise Express would match "me" as a :customerId value.
  controllers: [
    CustomersController,
    CustomerOwnDocumentsController,
    CustomerAdminDocumentsController,
  ],
  providers: [CustomersService, CustomerDocumentsService],
  exports: [CustomersService],
})
export class CustomersModule {}
