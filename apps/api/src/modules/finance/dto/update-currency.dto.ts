import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** code is the primary key and never changes after creation — everything
 * else about a currency can be edited (e.g. re-pegging exchangeRateToBase
 * as market rates move, or deactivating one no longer in use). */
export class UpdateCurrencyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 5)
  symbol?: string;

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
