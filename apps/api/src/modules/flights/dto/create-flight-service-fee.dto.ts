import { FlightServiceFeeType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateFlightServiceFeeDto {
  @IsEnum(FlightServiceFeeType)
  type: FlightServiceFeeType;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  percent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
