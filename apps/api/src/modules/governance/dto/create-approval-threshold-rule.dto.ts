import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateApprovalThresholdRuleDto {
  @IsString()
  type: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxAmount?: number;

  @IsInt()
  @Min(1)
  requiredApprovals: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
