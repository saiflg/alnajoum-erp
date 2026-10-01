import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRatePlanDto } from './create-rate-plan.dto';

export class UpdateRatePlanDto extends PartialType(CreateRatePlanDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
