import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateSupplierContactDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
