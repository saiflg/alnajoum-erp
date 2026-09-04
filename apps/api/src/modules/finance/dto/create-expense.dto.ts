import { PaymentMethod } from '@prisma/client';
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

export class CreateExpenseDto {
  @IsString()
  @MaxLength(100)
  category: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsDateString()
  date: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;
}
