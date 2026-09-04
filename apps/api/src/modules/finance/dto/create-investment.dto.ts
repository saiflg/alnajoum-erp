import { InvestmentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateInvestmentDto {
  @IsEnum(InvestmentType)
  type: InvestmentType;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsString()
  @MaxLength(200)
  investor: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
