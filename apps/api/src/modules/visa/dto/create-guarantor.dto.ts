import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateGuarantorDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @MinLength(6)
  phone: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsString()
  @MinLength(2)
  relationship: string;

  @IsOptional()
  @IsString()
  idType?: string;

  @IsOptional()
  @IsString()
  idNumber?: string;
}
