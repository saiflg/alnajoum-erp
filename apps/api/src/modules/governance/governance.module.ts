import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApprovalThresholdRulesController } from './approval-threshold-rules.controller';
import { ApprovalThresholdRulesService } from './approval-threshold-rules.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

/**
 * Phase 11 — the genuinely new cross-cutting governance concerns this
 * phase adds (approval engine, feature flags, system settings, API
 * keys), grouped together since none of them belongs inside an existing
 * domain module (Flight/Hotel/Visa/...) and none duplicates something
 * that already exists there (see each service's own doc comment).
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ApprovalsController,
    ApprovalThresholdRulesController,
    FeatureFlagsController,
    SystemSettingsController,
    ApiKeysController,
  ],
  providers: [
    ApprovalsService,
    ApprovalThresholdRulesService,
    FeatureFlagsService,
    SystemSettingsService,
    ApiKeysService,
  ],
  exports: [
    ApprovalsService,
    FeatureFlagsService,
    SystemSettingsService,
    ApiKeysService,
  ],
})
export class GovernanceModule {}
