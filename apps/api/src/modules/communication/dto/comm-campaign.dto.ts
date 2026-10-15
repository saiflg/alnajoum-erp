import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCampaignDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) name!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
  @IsIn(['WHATSAPP', 'EMAIL']) channel!: 'WHATSAPP' | 'EMAIL';
  @IsOptional() @IsString() @MaxLength(40) topic?: string;
  @IsOptional() @IsString() @MaxLength(40) segmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) templateId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(20_000) bodyText?: string;
  /** One value per template marker that the system does not fill in per person (offer, link, destination ...). */
  @IsOptional() @IsObject() variables?: Record<string, string>;
  @IsOptional() @IsDateString() scheduledAt?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
  @IsOptional() @IsString() @MaxLength(40) topic?: string;
  @IsOptional() @IsString() @MaxLength(40) segmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) templateId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(20_000) bodyText?: string;
  @IsOptional() @IsObject() variables?: Record<string, string>;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
}

export class ConfirmationDto {
  @IsIn(['WHATSAPP', 'EMAIL']) channel!: string;
  @IsString() @MaxLength(40) topic!: string;
  @IsOptional() @IsString() segmentId?: string | null;
  @IsOptional() @IsString() templateId?: string | null;
  @IsInt() @Min(0) eligibleCount!: number;
  @IsOptional() @IsString() scheduledAt?: string | null;
}

export class ApproveCampaignDto {
  @ValidateNested() @Type(() => ConfirmationDto) confirm!: ConfirmationDto;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class ReasonDto {
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class TestSendDto {
  @Transform(trim) @IsString() @MaxLength(254) to!: string;
}

export class ListCampaignsQueryDto {
  @IsOptional() @IsIn(['WHATSAPP', 'EMAIL']) channel?: 'WHATSAPP' | 'EMAIL';
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RecipientsQueryDto {
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class SimulateEmailEventDto {
  @IsString() @MaxLength(200) providerMessageId!: string;
  @IsIn(['DELIVERED', 'BOUNCED', 'COMPLAINT', 'CLICKED']) type!:
    'DELIVERED' | 'BOUNCED' | 'COMPLAINT' | 'CLICKED';
}

export class EmailWebhookEventDto {
  @IsString() @MaxLength(200) id!: string;
  @IsIn(['delivered', 'bounce', 'complaint', 'click', 'open', 'unsubscribe'])
  type!: string;
  @IsString() @MaxLength(200) messageId!: string;
  @IsOptional() @IsString() timestamp?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsIn(['hard', 'soft']) bounceType?: 'hard' | 'soft';
}

export class EmailWebhookDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailWebhookEventDto)
  events!: EmailWebhookEventDto[];
}
