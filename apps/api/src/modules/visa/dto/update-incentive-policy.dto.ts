import { PartialType } from '@nestjs/mapped-types';
import { CreateIncentivePolicyDto } from './create-incentive-policy.dto';

export class UpdateIncentivePolicyDto extends PartialType(
  CreateIncentivePolicyDto,
) {}
