import { PartialType } from '@nestjs/mapped-types';
import { CreateApprovalThresholdRuleDto } from './create-approval-threshold-rule.dto';

export class UpdateApprovalThresholdRuleDto extends PartialType(
  CreateApprovalThresholdRuleDto,
) {}
