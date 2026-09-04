import { TransportStatus, TransportType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateTransportDto {
  @IsEnum(TransportType)
  type: TransportType;

  // Exactly one of these must be set — checked in TransportService.create().
  @IsOptional()
  @IsString()
  hajjGroupId?: string;

  @IsOptional()
  @IsString()
  umrahGroupId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsString()
  pickupLocation: string;

  @IsString()
  dropoffLocation: string;

  @IsDateString()
  scheduledAt: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTransportStatusDto {
  @IsEnum(TransportStatus)
  status: TransportStatus;
}
