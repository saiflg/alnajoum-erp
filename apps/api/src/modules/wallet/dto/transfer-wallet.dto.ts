import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  IsOptional,
} from 'class-validator';

export class TransferWalletDto {
  @IsString()
  fromCustomerId: string;

  @IsString()
  toCustomerId: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsString()
  @MaxLength(255)
  description: string;

  /** Send the same key when retrying a request; the second attempt then returns the first result instead of repeating it. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
