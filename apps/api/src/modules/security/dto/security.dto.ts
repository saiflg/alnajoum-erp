import {
  AccessReviewDecision,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StepUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;
}

export class OpenIncidentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @IsOptional()
  @IsBoolean()
  personalDataInvolved?: boolean;
}

export class IncidentNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;
}

export class IncidentStatusDto {
  @IsEnum(IncidentStatus)
  status: IncidentStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  note: string;
}

export class ReviewDecisionDto {
  @IsEnum(AccessReviewDecision)
  decision: AccessReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class EraseCustomerDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}

export class BreakGlassRequestDto {
  @IsString()
  roleId: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;

  @IsInt()
  @Min(5)
  @Max(120)
  minutes: number;
}
