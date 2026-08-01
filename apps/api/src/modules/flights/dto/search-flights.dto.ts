import { CabinClass } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

function toUpperCase({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export class SearchFlightsDto {
  @IsString()
  @Length(3, 3)
  @Transform(toUpperCase)
  origin: string;

  @IsString()
  @Length(3, 3)
  @Transform(toUpperCase)
  destination: string;

  @IsDateString()
  departureDate: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @IsInt()
  @Min(1)
  @Max(9)
  adults: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  children?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  infants?: number;

  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;
}
