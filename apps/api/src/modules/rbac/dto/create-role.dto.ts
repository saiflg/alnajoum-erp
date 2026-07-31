import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys: string[];
}
