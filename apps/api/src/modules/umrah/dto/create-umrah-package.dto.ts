import { UmrahPackageType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UmrahIncentiveRuleDto {
  /** Percent of each payment against this package credited as staff incentive. */
  @IsNumber()
  @Min(0)
  @Max(100)
  percent: number;
}

export class CreateUmrahPackageDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(UmrahPackageType)
  packageType?: UmrahPackageType;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  costPrice: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  sellingPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsObject()
  incentiveRule?: UmrahIncentiveRuleDto;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  hotel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  flight?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  transport?: string;

  @IsOptional()
  @IsBoolean()
  visaIncluded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  maxPilgrims: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  seatsAvailable?: number;
}
