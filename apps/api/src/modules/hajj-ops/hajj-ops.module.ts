import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CrmModule } from '../crm/crm.module';
import { CustomersModule } from '../customers/customers.module';
import { UsersModule } from '../users/users.module';
import { CheckInController } from './checkin.controller';
import { CheckInService } from './checkin.service';
import { EmergencyContactController } from './emergency-contact.controller';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
import { HajjGroupsController } from './hajj-groups.controller';
import { HajjGroupsService } from './hajj-groups.service';
import { HajjOpsAutomationService } from './hajj-ops-automation.service';
import { HajjOpsReportsController } from './hajj-ops-reports.controller';
import { HajjOpsReportsService } from './hajj-ops-reports.service';
import { ManifestController } from './manifest.controller';
import { ManifestService } from './manifest.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import { PilgrimPortalController } from './pilgrim-portal.controller';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';
import { RoomAllocationController } from './room-allocation.controller';
import { RoomAllocationService } from './room-allocation.service';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { UmrahGroupsController } from './umrah-groups.controller';
import { UmrahGroupsService } from './umrah-groups.service';

/**
 * Phase 8 — Enterprise Hajj & Umrah pilgrim management, operations & group
 * control. Imports CrmModule for TasksService (spec #26's departure
 * countdown tasks reuse Phase 7's Task model/service rather than a second
 * task system), CustomersModule for identity->customer resolution (pilgrim
 * portal ownership checks), and UsersModule for identity->staff resolution,
 * matching the convention already used by CrmModule/SupportModule/HajjModule.
 */
@Module({
  imports: [AuditModule, UsersModule, CustomersModule, CrmModule],
  controllers: [
    HajjGroupsController,
    UmrahGroupsController,
    FleetController,
    TransportController,
    ReadinessController,
    CheckInController,
    EmergencyContactController,
    RoomAllocationController,
    ManifestController,
    PilgrimPortalController,
    HajjOpsReportsController,
  ],
  providers: [
    PilgrimLookupService,
    HajjGroupsService,
    UmrahGroupsService,
    FleetService,
    TransportService,
    ReadinessService,
    CheckInService,
    RoomAllocationService,
    ManifestService,
    HajjOpsReportsService,
    HajjOpsAutomationService,
  ],
  exports: [PilgrimLookupService, ReadinessService],
})
export class HajjOpsModule {}
