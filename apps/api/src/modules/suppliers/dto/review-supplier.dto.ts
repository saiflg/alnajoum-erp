import { SupplierKycStatus, SupplierRiskStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ReviewSupplierDto {
  @IsOptional()
  @IsEnum(SupplierKycStatus)
  kycStatus?: SupplierKycStatus;

  @IsOptional()
  @IsEnum(SupplierRiskStatus)
  riskStatus?: SupplierRiskStatus;
}
