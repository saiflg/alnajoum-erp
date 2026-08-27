import { CustomerType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UpdateCustomerProfileDto } from './update-customer-profile.dto';

/**
 * Staff-only extension of the self-service profile DTO — adds the fields a
 * customer must never be able to set on themself (their own type/segment,
 * or who manages their account).
 */
export class AdminUpdateCustomerDto extends UpdateCustomerProfileDto {
  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @IsOptional()
  @IsString()
  assignedStaffId?: string | null;

  @IsOptional()
  @IsString()
  assignedBranchId?: string | null;
}
