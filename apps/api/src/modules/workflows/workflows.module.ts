import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { CrmModule } from '../crm/crm.module';
import { GovernanceModule } from '../governance/governance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ActionRegistryService } from './actions/action-registry.service';
import { AutomationController } from './automation.controller';
import { PaymentWorkflowEventsListener } from './payment-events.listener';
import { WorkflowDispatcherService } from './workflow-dispatcher.service';
import { WorkflowExecutorService } from './workflow-executor.service';
import { WorkflowRateLimiterService } from './workflow-rate-limiter.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/**
 * Phase 21 — the workflow engine. It REUSES the existing task, notification, WhatsApp,
 * approval, audit and tenancy services; it does not duplicate them. The event bus lives in the
 * separate global WorkflowEventsModule so any module can publish without importing this one.
 */
@Module({
  imports: [
    AnalyticsModule,
    AuditModule,
    CrmModule,
    GovernanceModule,
    NotificationsModule,
    WhatsAppModule,
  ],
  controllers: [WorkflowsController, AutomationController],
  providers: [
    PaymentWorkflowEventsListener,
    ActionRegistryService,
    WorkflowRateLimiterService,
    WorkflowExecutorService,
    WorkflowDispatcherService,
    WorkflowSchedulerService,
    WorkflowsService,
  ],
  exports: [
    WorkflowsService,
    WorkflowExecutorService,
    WorkflowDispatcherService,
    WorkflowSchedulerService,
  ],
})
export class WorkflowsModule {}
