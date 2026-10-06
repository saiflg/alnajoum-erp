import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AnalyticsScopeService } from './analytics-scope.service';
import { DataQualityService } from './data-quality.service';
import { AnalyticsQueryDto, TrendQueryDto } from './dto/analytics-query.dto';
import {
  bucketKeys,
  defaultGranularity,
  fillBuckets,
  MAX_POINTS,
} from './engine/buckets';
import {
  getMetricDefinition,
  METRIC_DEFINITIONS_VERSION,
  UNAVAILABLE_METRICS,
  visibleDefinitions,
} from './engine/metric-definitions';
import { DateRange, PeriodError, resolveRange } from './engine/periods';
import { MetricsService } from './metrics.service';

const hasFinance = (user: AuthContext): boolean =>
  user.permissions.includes(PERMISSIONS.ANALYTICS.FINANCE_VIEW);

/** A bad period is the caller's mistake, not a server fault. */
function rangeFrom(q: AnalyticsQueryDto, now: Date): DateRange {
  try {
    return resolveRange(q.preset ?? 'THIS_MONTH', now, {
      from: q.from,
      to: q.to,
    });
  } catch (e) {
    if (e instanceof PeriodError) throw new BadRequestException(e.message);
    throw e;
  }
}

/**
 * Phase 20 executive analytics API. Tenant and branch come from AnalyticsScopeService
 * (token-derived), never from the request; finance figures need a second permission.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly scopes: AnalyticsScopeService,
    private readonly metrics: MetricsService,
    private readonly quality: DataQualityService,
  ) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW)
  async overview(
    @CurrentUser() user: AuthContext,
    @Query() q: AnalyticsQueryDto,
  ) {
    const now = new Date();
    const range = rangeFrom(q, now);
    const scope = await this.scopes.resolve(user, q.branchId);
    const comparison =
      q.comparison && q.comparison !== 'NONE' ? q.comparison : null;
    return this.metrics.overview({
      scope,
      range,
      comparison,
      canViewFinance: hasFinance(user),
      now,
    });
  }

  @Get('trend')
  @RequirePermissions(PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW)
  async trend(@CurrentUser() user: AuthContext, @Query() q: TrendQueryDto) {
    if (q.metric === 'cash_collected' && !hasFinance(user)) {
      throw new ForbiddenException(
        'Cash figures need the finance analytics permission',
      );
    }
    const now = new Date();
    const range = rangeFrom(q, now);
    const granularity = q.granularity ?? defaultGranularity(range);
    const keys = bucketKeys(range, granularity);
    if (keys.length > MAX_POINTS) {
      throw new BadRequestException(
        `That range has ${keys.length} ${granularity} points; choose a coarser granularity or a shorter range (max ${MAX_POINTS}).`,
      );
    }
    const scope = await this.scopes.resolve(user, q.branchId);
    const base = await this.metrics.baseCurrency(scope);
    const rows = await this.metrics.trend({
      scope,
      range,
      metric: q.metric,
      granularity,
      base,
    });
    const def = getMetricDefinition(q.metric);
    return {
      meta: {
        generatedAt: now.toISOString(),
        freshness: 'LIVE',
        definitionsVersion: METRIC_DEFINITIONS_VERSION,
        currency: base,
        metric: q.metric,
        name: def?.name ?? q.metric,
        unit: def?.unit ?? 'COUNT',
        granularity,
        range: {
          preset: range.preset,
          label: range.label,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        scope: {
          description: scope.description,
          branchId: scope.branchId ?? null,
          branchLocked: scope.branchLocked,
        },
      },
      status: rows === null ? 'UNAVAILABLE' : 'OK',
      unavailableReason:
        rows === null
          ? 'Payments carry no branch, so cash collected cannot be shown for a single branch'
          : undefined,
      points: rows === null ? [] : fillBuckets(keys, rows),
    };
  }

  @Get('branches')
  @RequirePermissions(PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW)
  async branches(
    @CurrentUser() user: AuthContext,
    @Query() q: AnalyticsQueryDto,
  ) {
    const now = new Date();
    const range = rangeFrom(q, now);
    const scope = await this.scopes.resolve(user, q.branchId);
    const base = await this.metrics.baseCurrency(scope);
    return {
      meta: {
        generatedAt: now.toISOString(),
        freshness: 'LIVE',
        currency: base,
        range: {
          label: range.label,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        scope: { description: scope.description },
      },
      branches: await this.metrics.byBranch(scope, range, base),
    };
  }

  @Get('metrics')
  @RequirePermissions(PERMISSIONS.ANALYTICS.DEFINITIONS_VIEW)
  definitions(@CurrentUser() user: AuthContext) {
    return {
      version: METRIC_DEFINITIONS_VERSION,
      metrics: visibleDefinitions(hasFinance(user)),
      unavailable: UNAVAILABLE_METRICS,
    };
  }

  @Get('data-quality')
  @RequirePermissions(PERMISSIONS.ANALYTICS.DATA_QUALITY_VIEW)
  async dataQuality(
    @CurrentUser() user: AuthContext,
    @Query() q: AnalyticsQueryDto,
  ) {
    const scope = await this.scopes.resolve(user, q.branchId);
    const base = await this.metrics.baseCurrency(scope);
    return this.quality.run(scope, base, new Date());
  }
}
