import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
