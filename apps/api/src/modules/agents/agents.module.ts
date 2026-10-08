import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { CrmModule } from '../crm/crm.module';
import { FinanceModule } from '../finance/finance.module';
import { FlightsModule } from '../flights/flights.module';
import { GovernanceModule } from '../governance/governance.module';
import { HajjOpsModule } from '../hajj-ops/hajj-ops.module';
import { HotelsModule } from '../hotels/hotels.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RbacModule } from '../rbac/rbac.module';
import { SecurityModule } from '../security/security.module';
import { SupportModule } from '../support/support.module';
import { VisaModule } from '../visa/visa.module';
import { WalletModule } from '../wallet/wallet.module';
import { AgentsController } from './controllers/agents.controller';
import { AiModelClient } from './runtime/model-client';
import { AgentAdminService } from './services/agent-admin.service';
import { AgentRunnerService } from './services/agent-runner.service';
import { AiApprovalsService } from './services/ai-approvals.service';
import { AiBudgetService } from './services/budget.service';
import { ConversationsService } from './services/conversations.service';
import { AiControlsService } from './services/controls.service';
import { DailyOperationsService } from './services/daily-operations.service';
import { AgentEventReactor } from './services/event-reactor.service';
import { AiFeedbackService } from './services/feedback.service';
import { AiKnowledgeService } from './services/knowledge.service';
import { AiMemoryService } from './services/memory.service';
import { AiObservabilityService } from './services/observability.service';
import { OperationsScannerService } from './services/operations-scanner.service';
import { PrincipalService } from './services/principal.service';
import { AiRecommendationsService } from './services/recommendations.service';
import { AiSafetyService } from './services/safety.service';
import { ToolRegistryService } from './tools/tool-registry.service';

/**
 * Phase 23 — the controlled AI agent layer on top of the existing ERP. It reuses the AI provider abstraction, the
 * approval engine, the workflow event bus, analytics, notifications, payments, flights and the readiness engine;
 * it adds the runtime (policy, guards, loop and budget protection), versioned agents, tools, memory, knowledge,
 * conversations with human takeover, scanners, and governance. See docs/ai-agents.md.
 */
@Module({
  imports: [
    AiModule,
    AuditModule,
    CrmModule,
    FinanceModule,
    FlightsModule,
    GovernanceModule,
    HajjOpsModule,
    HotelsModule,
    IntegrationsModule,
    NotificationsModule,
    PaymentsModule,
    RbacModule,
    SecurityModule,
    SupportModule,
    VisaModule,
    WalletModule,
  ],
  controllers: [AgentsController],
  providers: [
    ToolRegistryService,
    AiModelClient,
    PrincipalService,
    AgentAdminService,
    AgentRunnerService,
    AiApprovalsService,
    AiBudgetService,
    AiControlsService,
    AiSafetyService,
    AiMemoryService,
    AiKnowledgeService,
    AiRecommendationsService,
    AiFeedbackService,
    AiObservabilityService,
    ConversationsService,
    OperationsScannerService,
    DailyOperationsService,
    AgentEventReactor,
  ],
  exports: [
    AgentRunnerService,
    AiMemoryService,
    DailyOperationsService,
    AiControlsService,
  ],
})
export class AgentsModule {}
