import { CabinClass, TripType } from '@prisma/client';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

function toUpperCase({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export class FlightLegDto {
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
}

export class SearchFlightsDto {
  @IsEnum(TripType)
  tripType: TripType;

  @ValidateNested({ each: true })
  @Type(() => FlightLegDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  legs: FlightLegDto[];

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

  @IsOptional()
  @IsBoolean()
  directOnly?: boolean;
}
