import {
  AiBudgetPeriod,
  AiControlKind,
  AiFeedbackRating,
  AiRecommendationStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
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

export class AssistantMessageDto {
  @IsOptional() @IsString() @MaxLength(64) conversationId?: string;
  @IsString() @MinLength(1) @MaxLength(2000) content: string;
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
}

export class CopilotAskDto {
  @IsOptional() @IsString() @MaxLength(60) agent?: string;
  @IsString() @MinLength(1) @MaxLength(2000) objective: string;
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
}

export class SimulateDto {
  @IsString() @MaxLength(60) agent: string;
  @IsString() @MinLength(1) @MaxLength(2000) objective: string;
  /** Simulate a CUSTOMER agent as if this customer (in your company) had asked. */
  @IsOptional() @IsString() @MaxLength(64) customerId?: string;
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
}

export class DecideApprovalDto {
  @IsIn(['APPROVE', 'REJECT', 'CANCEL']) decision:
    'APPROVE' | 'REJECT' | 'CANCEL';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsObject() editedParams?: Record<string, unknown>;
}

export class RecommendationStatusDto {
  @IsEnum(AiRecommendationStatus) status: AiRecommendationStatus;
}

export class RecommendationTaskDto {
  @IsOptional() @IsString() @MaxLength(64) staffId?: string;
}

export class ControlDto {
  @IsEnum(AiControlKind) kind: AiControlKind;
  @IsOptional() @IsString() @MaxLength(80) targetKey?: string;
  @IsOptional() @IsObject() value?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  /** SUPER_ADMIN only: apply to the whole platform. */
  @IsOptional() @IsIn(['COMPANY', 'GLOBAL']) scope?: 'COMPANY' | 'GLOBAL';
  /** SUPER_ADMIN only: which company (default: their own). */
  @IsOptional() @IsString() @MaxLength(64) companyId?: string;
}

export class ClearControlDto {
  @IsEnum(AiControlKind) kind: AiControlKind;
  @IsOptional() @IsString() @MaxLength(80) targetKey?: string;
  @IsOptional() @IsIn(['COMPANY', 'GLOBAL']) scope?: 'COMPANY' | 'GLOBAL';
  @IsOptional() @IsString() @MaxLength(64) companyId?: string;
}

export class BudgetDto {
  @IsOptional() @IsString() @MaxLength(60) agentKey?: string;
  @IsEnum(AiBudgetPeriod) period: AiBudgetPeriod;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxTokens?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxRequests?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxCostMicros?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['COMPANY', 'GLOBAL']) scope?: 'COMPANY' | 'GLOBAL';
}

export class KnowledgeDto {
  @IsString() @MaxLength(40) category: string;
  @IsString() @MinLength(3) @MaxLength(200) title: string;
  @IsString() @MinLength(10) @MaxLength(20000) content: string;
  @IsOptional() @IsString() @MaxLength(120) sourceLabel?: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
  /** SUPER_ADMIN only: publish for every company. */
  @IsOptional() @IsBoolean() platformWide?: boolean;
}

export class FeedbackDto {
  @IsOptional() @IsString() @MaxLength(64) executionId?: string;
  @IsOptional() @IsString() @MaxLength(64) messageId?: string;
  @IsEnum(AiFeedbackRating) rating: AiFeedbackRating;
  @IsOptional() @IsString() @MaxLength(1500) note?: string;
}

export class CustomerFeedbackDto {
  @IsString() @IsNotEmpty() @MaxLength(64) messageId: string;
  @IsIn(['CORRECT', 'INCORRECT', 'UNSAFE']) rating:
    'CORRECT' | 'INCORRECT' | 'UNSAFE';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class DraftVersionDto {
  @IsOptional() @IsString() @MaxLength(20000) systemPrompt?: string;
  @IsOptional() @IsString() @MaxLength(40) promptVersion?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsString() @MinLength(5) @MaxLength(500) changeNote: string;
}

export class RollbackDto {
  @Type(() => Number) @IsInt() @Min(1) toVersion: number;
  @IsString() @MinLength(5) @MaxLength(500) note: string;
}

export class AgentStatusDto {
  @IsIn(['ACTIVE', 'DISABLED']) status: 'ACTIVE' | 'DISABLED';
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(2000) content: string;
}

export class MockFaultDto {
  @IsIn(['NONE', 'FAIL', 'TIMEOUT', 'MALFORMED', 'OUTAGE', 'EMPTY']) mode:
    'NONE' | 'FAIL' | 'TIMEOUT' | 'MALFORMED' | 'OUTAGE' | 'EMPTY';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) times?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120000)
  delayMs?: number;
  @IsOptional() @IsString() @MaxLength(60) agent?: string;
}

export class ScanDto {
  @IsOptional() @IsString() @MaxLength(64) companyId?: string;
}

export class ProposeDocumentDto {
  @IsString() @MaxLength(64) customerId: string;
  @IsString() @MinLength(1) @MaxLength(200) fileName: string;
  @IsOptional() @IsString() @MaxLength(20000) text?: string;
}

export class ApplyPassportDto {
  @IsString() @MaxLength(64) customerId: string;
  @IsString() @MinLength(6) @MaxLength(12) passportNumber: string;
  @IsDateString() passportExpiryDate: string;
  @IsBoolean() confirmed: boolean;
  @IsOptional() @IsBoolean() overwrite?: boolean;
}

export class TriageDto {
  @IsOptional() @IsString() @MaxLength(200) from?: string;
  @IsString() @MaxLength(300) subject: string;
  @IsString() @MinLength(1) @MaxLength(20000) body: string;
  @IsOptional() @IsBoolean() record?: boolean;
}

export class CallDto {
  @IsString() @MinLength(1) @MaxLength(30000) transcript: string;
  @IsOptional() @IsString() @MaxLength(30) callerPhone?: string;
  @IsOptional() @IsBoolean() otpVerified?: boolean;
}
