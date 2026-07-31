import { IsOptional, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  roleId: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
