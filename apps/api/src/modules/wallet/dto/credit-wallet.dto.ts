import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreditWalletDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
