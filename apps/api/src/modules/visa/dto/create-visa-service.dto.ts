import { VisaServiceStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVisaServiceDto {
  @IsString()
  @MinLength(2)
  country: string;

  @IsString()
  @MinLength(2)
  visaType: string;

  @IsOptional()
  @IsString()
  visaCategory?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  processingTime?: string;

  @IsOptional()
  @IsString()
  validityPeriod?: string;

  @IsOptional()
  @IsString()
  entryType?: string;

  @IsOptional()
  @IsString()
  requiredDocuments?: string;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  supplierCost?: number;

  @IsInt()
  @Min(0)
  companyCost: number;

  @IsInt()
  @Min(0)
  sellingPrice: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  processingFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  otherFees?: number;

  @IsOptional()
  @IsString()
  incentivePolicyId?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsEnum(VisaServiceStatus)
  status?: VisaServiceStatus;
}
