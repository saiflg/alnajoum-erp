import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FlightsModule } from '../flights/flights.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';

/**
 * Phase 11's "data export/import" and "backup management" — its own
 * module rather than folded into GovernanceModule (where the rest of
 * Phase 11's cross-cutting concerns live) specifically to avoid a
 * circular dependency: FlightsModule already imports GovernanceModule
 * (for ApprovalsService), so GovernanceModule importing FlightsModule
 * back — needed for DataExportService's exportFlightBookings — would
 * cycle. This module sits above both instead. BackupService has no such
 * dependency itself, but lives here too since it's the same "get this
 * platform's data out safely" family of admin tooling.
 */
@Module({
  imports: [
    CustomersModule,
    FlightsModule,
    PaymentsModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [DataExportController, DataImportController, BackupController],
  providers: [DataExportService, DataImportService, BackupService],
})
export class DataModule {}
