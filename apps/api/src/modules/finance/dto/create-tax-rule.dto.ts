import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Exactly one of ratePercent/fixedAmount is expected — a rate percentage
 * and a flat fee are two different tax shapes (e.g. VAT vs. an airport
 * departure levy), never combined into one rule.
 */
export class CreateTaxRuleDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @ValidateIf((dto: CreateTaxRuleDto) => dto.fixedAmount === undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @ValidateIf((dto: CreateTaxRuleDto) => dto.ratePercent === undefined)
  @IsInt()
  @Min(0)
  fixedAmount?: number;

  @IsOptional()
  @IsBoolean()
  isInclusive?: boolean;

  @IsOptional()
  @IsString()
  applicableService?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
