import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsScopeService } from './analytics-scope.service';
import { DataQualityService } from './data-quality.service';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsScopeService, MetricsService, DataQualityService],
  exports: [AnalyticsScopeService, MetricsService],
})
export class AnalyticsModule {}
