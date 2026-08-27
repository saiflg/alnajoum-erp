import { WalletTransactionType } from '@prisma/client';
import { IsEnum, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

const ADJUSTABLE_TYPES = [
  WalletTransactionType.ADJUSTMENT,
  WalletTransactionType.REFUND,
  WalletTransactionType.WITHDRAWAL,
] as const;

export class AdjustWalletDto {
  /** Signed: positive credits the wallet, negative debits it. */
  @IsInt()
  @Min(-100_000_000)
  @Max(100_000_000)
  amount: number;

  @IsEnum(ADJUSTABLE_TYPES)
  type: (typeof ADJUSTABLE_TYPES)[number];

  @IsString()
  @MaxLength(255)
  description: string;
}
