import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Graph and policy are validated structurally by the workflow engine (validateWorkflowVersion), not by decorators. */
export class CreateWorkflowDto {
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @IsObject() graph: Record<string, unknown>;
  @IsOptional() @IsObject() retryPolicy?: Record<string, unknown>;
}

export class SaveVersionDto {
  @IsObject() graph: Record<string, unknown>;
  @IsOptional() @IsObject() retryPolicy?: Record<string, unknown>;
  /** Required when the change creates a new version (the latest one is already locked). */
  @IsOptional() @IsString() @MaxLength(500) changeReason?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class SampleRunDto {
  /** The sample event payload (what a real event would carry). */
  @IsObject() payload: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) versionNo?: number;
  @IsOptional() @IsIn(['approved', 'rejected']) assumeApproval?:
    'approved' | 'rejected';
}

export class ActivateDto {
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) versionNo?: number;
}

export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class RetryDeadLetterDto {
  /** Needed to retry a step whose action moves money. */
  @IsOptional() @IsBoolean() confirmFinancial?: boolean;
}

export class ResolveDeadLetterDto {
  @IsString() @IsNotEmpty() @MinLength(5) @MaxLength(500) note: string;
}

export class ExecutionQueryDto {
  @IsOptional() @IsString() @MaxLength(64) workflowId?: string;
  @IsOptional()
  @IsIn([
    'RUNNING',
    'WAITING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'DEAD_LETTERED',
  ])
  status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) @Type(() => Number) offset?: number;
}

export class DeadLetterQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'RETRIED', 'CANCELLED', 'RESOLVED'])
  status?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number;
}

export class WorkflowListQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'TESTING', 'ACTIVE', 'PAUSED', 'DISABLED', 'ARCHIVED'])
  status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
