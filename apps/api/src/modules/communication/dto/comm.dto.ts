import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export const CONTACT_KINDS = [
  'CUSTOMER',
  'STAFF',
  'LEAD',
  'SUBSCRIBER',
  'OTHER',
] as const;

// ---------------------------------------------------------------------------------------------- settings

export class TopicDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,30}$/)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;
}

export class UpdateCommSettingsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  senderName?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) fromEmail?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(60) businessTimezone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  whatsappMessagesPerMinute?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  emailMessagesPerMinute?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  dailySendCap?: number;

  @IsOptional() @IsBoolean() testMode?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(254, { each: true })
  testRecipients?: string[];
  @IsOptional() @IsBoolean() killSwitch?: boolean;
  @IsOptional() @IsBoolean() doubleOptInEmail?: boolean;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
  @IsOptional() @IsObject() maxCampaignSizeByRole?: Record<string, number>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  privacyNoticeUrl?: string;
  @IsOptional() @IsString() @MaxLength(20) consentTextVersion?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(600)
  consentTextWhatsApp?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(600)
  consentTextEmail?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TopicDto)
  topics?: TopicDto[];
  @IsOptional() @IsBoolean() aiMayUseContactData?: boolean;
}

// ---------------------------------------------------------------------------------------------- contacts

export class CreateContactDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(['en', 'ha', 'ar']) preferredLanguage?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) country?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) source?: string;
  @IsOptional() @IsIn(CONTACT_KINDS) kind?: (typeof CONTACT_KINDS)[number];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'], {
    each: true,
  })
  interests?: string[];
}

export class UpdateContactDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(['en', 'ha', 'ar']) preferredLanguage?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) country?: string;
  @IsOptional() @IsIn(CONTACT_KINDS) kind?: (typeof CONTACT_KINDS)[number];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'], {
    each: true,
  })
  interests?: string[];
}

export class ListContactsQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn(CONTACT_KINDS) kind?: (typeof CONTACT_KINDS)[number];
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) tag?: string;
  @IsOptional()
  @IsIn(['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'])
  interest?: string;
  @IsOptional() @IsIn(CHANNELS) subscribedTo?: (typeof CHANNELS)[number];
  @IsOptional()
  @IsIn(['SUBSCRIBED', 'PENDING_CONFIRMATION', 'UNSUBSCRIBED', 'NONE'])
  subscription?: string;
  @IsOptional() @IsIn(['ACTIVE', 'MERGED', 'ERASED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class MergeContactsDto {
  /** The record that survives; the others are folded into it. */
  @IsString() @MaxLength(40) survivorId!: string;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mergeIds!: string[];
}

export class ImportRowDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
}

export class ImportContactsDto {
  /** Raw CSV text (header row required). Columns: name, phone, email, language, country, kind, tags, interests. */
  @IsString() @MaxLength(2_000_000) csv!: string;
  /** Validate and report only; nothing is written. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) source?: string;
}

// ---------------------------------------------------------------------------------------------- consent

export class RecordConsentDto {
  @IsIn(CHANNELS) channel!: (typeof CHANNELS)[number];
  @IsIn(['GRANTED', 'WITHDRAWN']) action!: 'GRANTED' | 'WITHDRAWN';
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topics?: string[];
  /** How the person gave it, when an administrator records it on their behalf: required for a grant. */
  @IsOptional()
  @IsIn([
    'WRITTEN_FORM',
    'VERBAL_RECORDED',
    'IN_PERSON',
    'EMAIL_REPLY',
    'WHATSAPP_REPLY',
    'OTHER',
  ])
  evidence?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class SuppressAddressDto {
  @IsIn(CHANNELS) channel!: (typeof CHANNELS)[number];
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(254) value!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}

export class LiftSuppressionDto {
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}

export class ListSuppressionQueryDto {
  @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @IsOptional()
  @IsIn(['UNSUBSCRIBED', 'BOUNCED', 'COMPLAINT', 'INVALID_ADDRESS', 'ADMIN'])
  reason?: string;
  @IsOptional() @IsIn(['true', 'false']) includeLifted?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

// ---------------------------------------------------------------------------------------------- public

export class PublicSubscribeDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(254) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsBoolean() whatsapp?: boolean;
  @IsOptional() @IsBoolean() emailMarketing?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topics?: string[];
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
  /** The version of the consent wording the person saw on the page; a stale page is rejected, not silently accepted. */
  @IsOptional() @IsString() @MaxLength(20) textVersion?: string;
  /** Honeypot: real people leave it empty. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class PublicPreferencesDto {
  @IsOptional() @IsBoolean() whatsapp?: boolean;
  @IsOptional() @IsBoolean() emailMarketing?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topics?: string[];
  @IsOptional() @IsIn(['en', 'ha', 'ar']) language?: string;
}

export class PublicUnsubscribeDto {
  @IsOptional() @IsIn([...CHANNELS, 'ALL']) channel?:
    'WHATSAPP' | 'EMAIL' | 'ALL';
}
