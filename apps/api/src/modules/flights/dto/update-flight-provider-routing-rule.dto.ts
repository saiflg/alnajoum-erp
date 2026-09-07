import { PartialType } from '@nestjs/mapped-types';
import { CreateFlightProviderRoutingRuleDto } from './create-flight-provider-routing-rule.dto';

export class UpdateFlightProviderRoutingRuleDto extends PartialType(
  CreateFlightProviderRoutingRuleDto,
) {}
