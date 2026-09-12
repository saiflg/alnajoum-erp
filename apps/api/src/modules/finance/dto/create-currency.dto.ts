import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCurrencyDto {
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'code must be a 3-letter ISO 4217 code, e.g. NGN',
  })
  code: string;

  @IsString()
  name: string;

  @IsString()
  @Length(1, 5)
  symbol: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  decimalPlaces?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRateToBase?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
