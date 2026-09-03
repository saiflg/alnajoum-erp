import { IncentivePolicyType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateIncentivePolicyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEnum(IncentivePolicyType)
  type: IncentivePolicyType;

  /**
   * Type-specific parameters — see IncentivePolicy's schema.prisma doc
   * comment for the exact shape each `type` expects (e.g.
   * PERCENT_OF_MARGIN -> { percent: 50 }). Validated at use time by
   * VisaIncentivesService.calculate() rather than here, since the valid
   * shape depends on `type`.
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
