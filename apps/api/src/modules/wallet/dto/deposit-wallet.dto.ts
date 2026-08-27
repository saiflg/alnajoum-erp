import { IsInt, Max, Min } from 'class-validator';

export class DepositWalletDto {
  @IsInt()
  @Min(100)
  @Max(100_000_000)
  amount: number;
}
