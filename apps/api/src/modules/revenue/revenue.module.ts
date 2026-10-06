import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PricingPolicyService } from './pricing-policy.service';
import { PricingRulesService } from './pricing-rules.service';
import { PromotionsService } from './promotions.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

@Module({
  imports: [AuditModule],
  controllers: [RevenueController],
  providers: [
    RevenueService,
    PricingRulesService,
    PricingPolicyService,
    PromotionsService,
  ],
  exports: [RevenueService, PricingPolicyService, PromotionsService],
})
export class RevenueModule {}
