import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Deliberately depends only on Prisma + AuditModule (both leaf modules) —
 * FlightsModule, PaymentsModule, and NotificationsModule all need to import
 * this to resolve their active provider/credentials at call time, and any
 * of those three appearing in IntegrationsModule's own dependency graph
 * would create a circular import. Same reasoning as IncentivesModule.
 */
@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
