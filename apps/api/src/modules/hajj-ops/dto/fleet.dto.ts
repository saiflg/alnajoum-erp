import {
  DriverStatus,
  VehicleFleetStatus,
  VehicleFleetType,
} from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  plateNumber: string;

  @IsEnum(VehicleFleetType)
  type: VehicleFleetType;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVehicleStatusDto {
  @IsEnum(VehicleFleetStatus)
  status: VehicleFleetStatus;
}

export class CreateDriverDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone: string;

  // Sensitive — only ever set/read through a DRIVER_MANAGE-gated route.
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;
}

export class UpdateDriverStatusDto {
  @IsEnum(DriverStatus)
  status: DriverStatus;
}
