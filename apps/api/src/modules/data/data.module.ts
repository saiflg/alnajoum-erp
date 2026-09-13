import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FlightsModule } from '../flights/flights.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';

/**
 * Phase 11's "data export/import" — its own module rather than folded
 * into GovernanceModule (where the rest of Phase 11's cross-cutting
 * concerns live) specifically to avoid a circular dependency:
 * FlightsModule already imports GovernanceModule (for ApprovalsService),
 * so GovernanceModule importing FlightsModule back — needed for
 * DataExportService's exportFlightBookings — would cycle. This module
 * sits above both instead.
 */
@Module({
  imports: [
    CustomersModule,
    FlightsModule,
    PaymentsModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [DataExportController, DataImportController],
  providers: [DataExportService, DataImportService],
})
export class DataModule {}
