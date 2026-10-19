import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Moves a staff member to another branch (or, with no branchId, to no branch: head office). */
export class TransferStaffDto {
  @IsOptional()
  @IsString()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** Promotes or demotes: replaces the person's role with another. */
export class ChangeStaffRoleDto {
  @IsString()
  roleId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
