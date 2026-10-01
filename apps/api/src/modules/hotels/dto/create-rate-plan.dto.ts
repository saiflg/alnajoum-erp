import { MealPlan } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRatePlanDto {
  @IsString()
  roomTypeId: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(MealPlan)
  mealPlan?: MealPlan;

  @IsOptional()
  @IsInt()
  @Min(1)
  occupancy?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsInt()
  @Min(0)
  netPrice: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  grossPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  feeAmount?: number;

  @IsOptional()
  @IsNumber()
  markupPercent?: number;

  @IsOptional()
  @IsString()
  cancellationPolicy?: string;

  @IsOptional()
  @IsString()
  changePolicy?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  minStay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxStay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  advancePurchaseDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  releasePeriodDays?: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
