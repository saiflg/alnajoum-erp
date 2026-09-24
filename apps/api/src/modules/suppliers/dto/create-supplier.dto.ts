import { SupplierType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MinLength(2)
  legalName: string;

  @IsOptional()
  @IsString()
  tradingName?: string;

  @IsEnum(SupplierType)
  type: SupplierType;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  settlementCurrency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  settlementCycle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  depositRequired?: number;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  taxIdentificationNumber?: string;

  @IsOptional()
  @IsString()
  accountManagerStaffId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
