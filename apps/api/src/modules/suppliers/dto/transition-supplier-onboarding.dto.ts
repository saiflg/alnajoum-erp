import { SupplierOnboardingStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class TransitionSupplierOnboardingDto {
  @IsEnum(SupplierOnboardingStatus)
  status: SupplierOnboardingStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
