import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { FlightSupplierStatus } from '@prisma/client';
import { CreateFlightSupplierDto } from './create-flight-supplier.dto';

export class UpdateFlightSupplierDto extends PartialType(
  CreateFlightSupplierDto,
) {
  @IsOptional()
  @IsEnum(FlightSupplierStatus)
  status?: FlightSupplierStatus;

  @IsOptional()
  @IsString()
  apiStatus?: string;
}
