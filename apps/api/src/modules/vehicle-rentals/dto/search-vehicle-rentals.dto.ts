import { VehicleType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class SearchVehicleRentalsDto {
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @IsString()
  @MinLength(2)
  pickupCity: string;

  @IsDateString()
  pickupAt: string;

  @IsDateString()
  dropoffAt: string;

  @IsOptional()
  @IsBoolean()
  withDriver?: boolean;
}
