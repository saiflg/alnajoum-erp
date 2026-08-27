import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateHajjPackageDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  internalCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  airline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  hotel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  accommodation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  transport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  meals?: string;

  @IsOptional()
  @IsBoolean()
  visaIncluded?: boolean;

  @IsOptional()
  @IsBoolean()
  ziyaratIncluded?: boolean;

  @IsOptional()
  @IsBoolean()
  guideIncluded?: boolean;

  @IsInt()
  @Min(1)
  @Max(100_000)
  maxPilgrims: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  seatsAvailable?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  paymentPlan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  termsAndConditions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requiredDocuments?: string;
}
