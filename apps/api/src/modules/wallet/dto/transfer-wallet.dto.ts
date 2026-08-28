import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
