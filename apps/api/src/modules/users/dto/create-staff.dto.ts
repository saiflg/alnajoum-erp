import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStaffDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  @MaxLength(30)
  employeeCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsString()
  roleId: string;
}
