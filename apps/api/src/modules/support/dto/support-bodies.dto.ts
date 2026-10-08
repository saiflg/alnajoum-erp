import { TicketPriority, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CategoryNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class SlaTargetDto {
  @IsEnum(TicketPriority)
  priority: TicketPriority;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 30)
  responseMinutes: number;
}

export class TicketAssignDto {
  @IsString()
  @MaxLength(64)
  staffId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;
}

export class TicketStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;
}

export class EscalationRuleDto {
  @IsEnum(TicketPriority)
  priority: TicketPriority;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 30)
  afterMinutes: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  notifyRole: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  order: number;
}
