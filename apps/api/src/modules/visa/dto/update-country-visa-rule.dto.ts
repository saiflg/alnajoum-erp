import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateCountryVisaRuleDto } from './create-country-visa-rule.dto';

// country/visaType identify the rule and aren't editable after creation —
// create a new rule instead of retargeting an existing one.
export class UpdateCountryVisaRuleDto extends PartialType(
  OmitType(CreateCountryVisaRuleDto, ['country', 'visaType'] as const),
) {}
