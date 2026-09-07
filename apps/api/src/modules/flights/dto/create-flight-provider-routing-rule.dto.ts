import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { FlightProviderName } from '@prisma/client';

export class CreateFlightProviderRoutingRuleDto {
  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(FlightProviderName, { each: true })
  providerPriority: FlightProviderName[];

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
