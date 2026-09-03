import { ApprovalStatus, VerificationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class VerifyGuarantorDto {
  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;

  @IsOptional()
  @IsEnum(ApprovalStatus)
  approvalStatus?: ApprovalStatus;

  @IsOptional()
  @IsString()
  verificationNote?: string;
}
