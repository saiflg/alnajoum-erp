import { PartialType } from '@nestjs/mapped-types';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CreatePricingRuleDto } from './create-pricing-rule.dto';

export class UpdatePricingRuleDto extends PartialType(CreatePricingRuleDto) {
  /** Every change to a commercial rule must say why — it is stored on the immutable version row and in the audit log. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /** Optimistic concurrency: the version the editor was looking at. A mismatch means someone else changed it first. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
