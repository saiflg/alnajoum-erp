import { PartialType } from '@nestjs/mapped-types';
import { CreateFlightPricingRuleDto } from './create-flight-pricing-rule.dto';

export class UpdateFlightPricingRuleDto extends PartialType(
  CreateFlightPricingRuleDto,
) {}
