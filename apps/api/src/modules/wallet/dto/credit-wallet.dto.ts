import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreditWalletDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /** Send the same key when retrying a request; the second attempt then returns the first result instead of repeating it. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
