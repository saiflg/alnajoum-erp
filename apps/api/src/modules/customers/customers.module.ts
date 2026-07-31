import { Module } from '@nestjs/common';
import { CustomerAdminDocumentsController } from './documents/customer-admin-documents.controller';
import { CustomerDocumentsService } from './documents/customer-documents.service';
import { CustomerOwnDocumentsController } from './documents/customer-own-documents.controller';
import { CustomerAdminFamilyMembersController } from './family-members/customer-admin-family-members.controller';
import { CustomerOwnFamilyMembersController } from './family-members/customer-own-family-members.controller';
import { FamilyMemberDocumentsService } from './family-members/documents/family-member-documents.service';
import { FamilyMembersService } from './family-members/family-members.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  // Order matters: the static "customers/me/..." routes must be registered
  // before the dynamic "customers/:customerId/..." ones, otherwise Express
  // would match "me" as a :customerId value.
  controllers: [
    CustomersController,
    CustomerOwnDocumentsController,
    CustomerOwnFamilyMembersController,
    CustomerAdminDocumentsController,
    CustomerAdminFamilyMembersController,
  ],
  providers: [
    CustomersService,
    CustomerDocumentsService,
    FamilyMembersService,
    FamilyMemberDocumentsService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
