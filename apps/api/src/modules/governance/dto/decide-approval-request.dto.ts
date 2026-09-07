import { ApprovalDecisionType } from '@prisma/client';
import { IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';

export class DecideApprovalRequestDto {
  @IsEnum(ApprovalDecisionType)
  decision: ApprovalDecisionType;

  // Spec #11 — "rejected requests must contain a reason." Optional on an
  // approval (a short note is welcome but not required).
  @ValidateIf((dto: DecideApprovalRequestDto) => dto.decision === 'REJECTED')
  @IsString()
  @MinLength(3)
  reason?: string;
}
