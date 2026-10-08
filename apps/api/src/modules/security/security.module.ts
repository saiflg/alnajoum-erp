import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AccessReviewsService } from './access-reviews.service';
import { BreakGlassService } from './break-glass.service';
import { IncidentsService } from './incidents.service';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';
import { SecurityController } from './security.controller';
import { SecurityOverviewService } from './security-overview.service';
import { StepUpService } from './step-up.service';

/** Phase 22 - security operations and compliance records. See docs/security.md. */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [SecurityController],
  providers: [
    SecurityOverviewService,
    IncidentsService,
    AccessReviewsService,
    PrivacyService,
    RetentionService,
    BreakGlassService,
    StepUpService,
  ],
  exports: [BreakGlassService, RetentionService],
})
export class SecurityModule {}
