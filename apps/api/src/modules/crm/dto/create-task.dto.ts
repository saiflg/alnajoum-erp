import { TaskPriority, TaskRelatedType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(TaskRelatedType)
  relatedType: TaskRelatedType;

  @IsOptional()
  @IsString()
  relatedId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsString()
  assignedStaffId: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
