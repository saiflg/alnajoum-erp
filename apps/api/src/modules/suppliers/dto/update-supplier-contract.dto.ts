import { PartialType } from '@nestjs/mapped-types';
import { SupplierContractStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateSupplierContractDto } from './create-supplier-contract.dto';

export class UpdateSupplierContractDto extends PartialType(
  CreateSupplierContractDto,
) {
  @IsOptional()
  @IsEnum(SupplierContractStatus)
  status?: SupplierContractStatus;
}
