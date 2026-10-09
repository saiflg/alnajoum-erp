import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AiAnalyticsController } from './ai-analytics.controller';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiUsageAdminController } from './ai-usage-admin.controller';
import { AiUsageService } from './ai-usage.service';
import { AiProviderRouter } from './providers/ai-provider.router';
import { MockAiFaultService } from './providers/mock-ai-faults.service';
import { MockAiProviderService } from './providers/mock-ai-provider.service';
import { OpenAiCompatibleAiProviderService } from './providers/openai-compatible-ai-provider.service';

/** Phase 13 — the AI abstraction layer + its first concrete capability
 * (admin natural-language analytics). See AiAnalyticsService's doc
 * comment for the safety model this whole module is built around. */
@Module({
  imports: [IntegrationsModule, AnalyticsModule],
  controllers: [AiAnalyticsController, AiUsageAdminController],
  providers: [
    AiAnalyticsService,
    AiUsageService,
    AiProviderRouter,
    MockAiProviderService,
    MockAiFaultService,
    OpenAiCompatibleAiProviderService,
  ],
  exports: [
    AiAnalyticsService,
    AiUsageService,
    AiProviderRouter,
    MockAiProviderService,
    MockAiFaultService,
  ],
})
export class AiModule {}
