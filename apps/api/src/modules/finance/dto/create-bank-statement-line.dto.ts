import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankStatementLineDto {
  @IsDateString()
  date: string;

  @IsString()
  @MaxLength(500)
  description: string;

  // Signed: positive = inflow, negative = outflow.
  @IsInt()
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalReference?: string;
}
