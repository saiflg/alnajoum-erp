import { CampaignStatus, TaskStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request bodies that used to be typed inline in the controllers. An inline type is erased at runtime, so the
 * global ValidationPipe (whitelist, forbidNonWhitelisted) never saw them and any shape was accepted. Each is a
 * real class now.
 */
export class CampaignStatusDto {
  @IsEnum(CampaignStatus)
  status: CampaignStatus;
}

export class TaskStatusDto {
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

export class ComplaintCreateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description: string;
}

export class ComplaintAssignDto {
  @IsString()
  @MaxLength(64)
  staffId: string;
}

export class ComplaintNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  note: string;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class ComplaintResolutionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  resolution: string;
}

export class ComplaintEscalateDto {
  @IsString()
  @MaxLength(64)
  toRole: string;
}

export class NameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class NoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  note: string;
}

export class LeadStageCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  order: number;
}

export class LeadStageMoveDto {
  @IsString()
  @MaxLength(64)
  stageId: string;
}

export class LeadAssignDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  staffId?: string;

  @IsOptional()
  @IsIn(['ROUND_ROBIN'])
  method?: 'ROUND_ROBIN';
}

export class ReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason: string;
}

export class ReferralRewardDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  rewardAmount: number;
}

export class CampaignCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  targetService: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  budget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  channel?: string;
}

export class FeedbackCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  serviceType: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  staffRating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  staffId?: string;
}

export class LeadConvertDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  existingCustomerId?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'CORPORATE', 'FAMILY'])
  mode?: 'CUSTOMER' | 'CORPORATE' | 'FAMILY';
}

export class ReferralCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  serviceType: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  transactionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  transactionAmount: number;
}
