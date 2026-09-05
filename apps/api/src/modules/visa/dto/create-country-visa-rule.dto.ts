import { DocumentType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCountryVisaRuleDto {
  @IsString()
  @MinLength(2)
  country: string;

  // Must match VisaApplication.visaType's actual values — the VisaType
  // enum's literal names (e.g. "PILGRIMAGE", "TOURIST"), since that's what
  // getApplicableRule() looks this up against. Omit to create this
  // country's fallback/default rule instead of a type-specific one.
  @IsOptional()
  @IsString()
  visaType?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(DocumentType, { each: true })
  requiredDocumentTypes?: DocumentType[];

  @IsOptional()
  @IsArray()
  @IsEnum(DocumentType, { each: true })
  optionalDocumentTypes?: DocumentType[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minPassportValidityMonths?: number;

  @IsOptional()
  @IsString()
  photoRequirements?: string;

  @IsOptional()
  @IsBoolean()
  guarantorRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  processingTimeDays?: number;

  @IsOptional()
  @IsBoolean()
  appointmentRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  insuranceRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  feeAmount?: number;

  @IsOptional()
  @IsString()
  feeCurrency?: string;

  @IsOptional()
  @IsString()
  restrictions?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
