import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { FlightSupplierContractStatus } from '@prisma/client';
import { CreateFlightSupplierContractDto } from './create-flight-supplier-contract.dto';

export class UpdateFlightSupplierContractDto extends PartialType(
  CreateFlightSupplierContractDto,
) {
  @IsOptional()
  @IsEnum(FlightSupplierContractStatus)
  status?: FlightSupplierContractStatus;
}
