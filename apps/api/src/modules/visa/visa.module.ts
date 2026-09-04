import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { GuarantorsAdminController } from './guarantors-admin.controller';
import { GuarantorsOwnController } from './guarantors-own.controller';
import { GuarantorsService } from './guarantors.service';
import { IncentivePoliciesController } from './incentive-policies.controller';
import { IncentivePoliciesService } from './incentive-policies.service';
import { MockStaffPayoutProviderService } from './providers/mock-staff-payout-provider.service';
import { STAFF_PAYOUT_PROVIDER } from './providers/staff-payout-provider.port';
import { StaffPayoutsController } from './staff-payouts.controller';
import { StaffPayoutsService } from './staff-payouts.service';
import { VisaApplicationsAdminController } from './visa-applications-admin.controller';
import { VisaApplicationsOwnController } from './visa-applications-own.controller';
import { VisaDocumentsAdminController } from './visa-documents-admin.controller';
import { VisaDocumentsOwnController } from './visa-documents-own.controller';
import { VisaDocumentsService } from './visa-documents.service';
import { VisaIncentivesController } from './visa-incentives.controller';
import { VisaIncentivesService } from './visa-incentives.service';
import { VisaPublicController } from './visa-public.controller';
import { VisaReportsController } from './visa-reports.controller';
import { VisaReportsService } from './visa-reports.service';
import { VisaServicesController } from './visa-services.controller';
import { VisaServicesService } from './visa-services.service';
import { VisaService } from './visa.service';

@Module({
  // Order matters: the static "visa/applications/me" and
  // "visa/services/public" routes must be registered before the dynamic
  // "visa/applications/:id" / "visa/services/:id" ones.
  imports: [
    CustomersModule,
    UsersModule,
    PaymentsModule,
    NotificationsModule,
    AuditModule,
    FinanceModule,
  ],
  controllers: [
    VisaApplicationsOwnController,
    VisaApplicationsAdminController,
    VisaPublicController,
    VisaServicesController,
    IncentivePoliciesController,
    VisaIncentivesController,
    StaffPayoutsController,
    GuarantorsOwnController,
    GuarantorsAdminController,
    VisaDocumentsOwnController,
    VisaDocumentsAdminController,
    VisaReportsController,
  ],
  providers: [
    VisaService,
    VisaServicesService,
    IncentivePoliciesService,
    VisaIncentivesService,
    GuarantorsService,
    VisaDocumentsService,
    VisaReportsService,
    MockStaffPayoutProviderService,
    // Only one payout provider today — kept behind the
    // STAFF_PAYOUT_PROVIDER token (not MockStaffPayoutProviderService
    // injected directly) so a real bank-transfer/payroll API is a DI-
    // binding change here later, matching FlightsModule/PaymentsModule's
    // pattern.
    {
      provide: STAFF_PAYOUT_PROVIDER,
      useExisting: MockStaffPayoutProviderService,
    },
    StaffPayoutsService,
  ],
  exports: [VisaService, VisaDocumentsService, VisaIncentivesService],
})
export class VisaModule {}
