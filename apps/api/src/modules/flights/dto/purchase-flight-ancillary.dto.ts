import { FlightAncillaryType } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class PurchaseFlightAncillaryDto {
  @IsEnum(FlightAncillaryType)
  type: FlightAncillaryType;

  @IsString()
  @MinLength(2)
  description: string;
}
