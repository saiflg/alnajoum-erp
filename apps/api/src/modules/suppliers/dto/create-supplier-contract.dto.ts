import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSupplierContractDto {
  @IsString()
  @MinLength(1)
  contractNumber: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  creditTerms?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rebatePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  markupPercent?: number;

  @IsOptional()
  @IsString()
  settlementCycle?: string;

  @IsOptional()
  @IsString()
  cancellationConditions?: string;

  @IsOptional()
  @IsString()
  amendmentConditions?: string;

  @IsOptional()
  @IsString()
  documentUrl?: string;
}
