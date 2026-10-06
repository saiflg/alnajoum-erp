import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const RANGE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'PREVIOUS_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'CUSTOM',
] as const;
export const COMPARISONS = [
  'NONE',
  'PREVIOUS_PERIOD',
  'PREVIOUS_MONTH',
  'PREVIOUS_QUARTER',
  'PREVIOUS_YEAR',
] as const;
export const TREND_METRICS = [
  'booked_value',
  'bookings_count',
  'cash_collected',
] as const;
export const TREND_GRANULARITIES = ['day', 'week', 'month'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every analytics call takes a period and (optionally) one branch. The tenant is NEVER a parameter. */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(RANGE_PRESETS)
  preset?: (typeof RANGE_PRESETS)[number];

  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a date like 2026-10-01' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a date like 2026-10-31' })
  to?: string;

  @IsOptional()
  @IsIn(COMPARISONS)
  comparison?: (typeof COMPARISONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;
}

export class TrendQueryDto extends AnalyticsQueryDto {
  @IsIn(TREND_METRICS)
  metric: (typeof TREND_METRICS)[number];

  @IsOptional()
  @IsIn(TREND_GRANULARITIES)
  granularity?: (typeof TREND_GRANULARITIES)[number];
}
