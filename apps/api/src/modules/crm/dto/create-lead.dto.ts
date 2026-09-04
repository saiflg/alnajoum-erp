import { LeadPriority, LeadSource } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(30)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsEnum(LeadSource)
  source: LeadSource;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  interestedService?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destination?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsString()
  assignedStaffId?: string;

  @IsOptional()
  @IsString()
  assignedBranchId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  followUpDate?: string;
}
