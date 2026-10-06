import { IsNumber, IsObject, IsOptional, Max, Min } from 'class-validator';
import { IsInt } from 'class-validator';

export class UpsertPricingPolicyDto {
  @IsOptional() @IsInt() @Min(0) minAbsoluteMargin?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minPercentMargin?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) maxDiscountPercent?: number;

  /** { FLIGHT: { minAbsolute, minPercent, maxDiscountPercent }, ... } — validated in PricingPolicyService. */
  @IsOptional() @IsObject() productOverrides?: Record<string, unknown>;
}
