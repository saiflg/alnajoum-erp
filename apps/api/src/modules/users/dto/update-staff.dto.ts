import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateStaffDto } from './create-staff.dto';

export class UpdateStaffDto extends PartialType(
  OmitType(CreateStaffDto, ['email', 'companyId', 'roleId'] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
