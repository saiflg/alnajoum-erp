import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class IssueCardDto {
  @IsString()
  @MaxLength(40)
  staffId!: string;

  /** Activate straight away, or leave PENDING until the printed card is handed over. */
  @IsOptional()
  @IsBoolean()
  activateNow?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number;
}

export class RenewCardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class OptionalReasonDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** For the actions that take something away or override a control: the reason is mandatory. */
export class RequiredReasonDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Please give a reason (at least 3 characters).' })
  @MaxLength(500)
  reason!: string;
}

export class ReplaceCardDto extends RequiredReasonDto {
  @IsOptional()
  @IsBoolean()
  activateNow?: boolean;
}

export class PrintCardsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  cardIds!: string[];

  /** `cards`: one CR80 card per page (PVC printers). `sheet`: A4 sheets of 10 with cut guides. */
  @IsOptional()
  @IsIn(['cards', 'sheet'])
  layout?: 'cards' | 'sheet';
}

export class ListCardsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REPLACED'])
  status?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  department?: string;

  /** Only cards that are active and expire within this many days. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiringWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ScanHistoryQueryDto {
  @IsOptional()
  @IsIn(['VALID', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REPLACED', 'INVALID'])
  result?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class VerifyLookupDto {
  /** QR: the scanned text (a verification link or the bare token). MANUAL_*: what the person typed. */
  @IsIn(['QR', 'MANUAL_STAFF_ID', 'MANUAL_REFERENCE'])
  method!: 'QR' | 'MANUAL_STAFF_ID' | 'MANUAL_REFERENCE';

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  value!: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export class UpdateCardSettingsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  tagline?: string;

  @IsOptional()
  @Matches(HEX, { message: 'Use a colour like #0f172a' })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX, { message: 'Use a colour like #f59e0b' })
  accentColor?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  signatoryName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  signatoryTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  contactEmail?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  contactAddress?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  website?: string;

  /** Printed only if the company supplies it; the system never invents a registration or accreditation line. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  officialRegistrationLine?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  emergencyContact?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  lostCardNotice?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  expiryWarningDays?: number;
}
