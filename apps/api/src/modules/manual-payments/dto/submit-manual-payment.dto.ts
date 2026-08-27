import { PaymentMethod } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MANUAL_PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.BANK_TRANSFER,
] as const;

export class SubmitManualPaymentDto {
  @IsString()
  customerId: string;

  @IsString()
  invoiceId: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsIn(MANUAL_PAYMENT_METHODS)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transactionReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
