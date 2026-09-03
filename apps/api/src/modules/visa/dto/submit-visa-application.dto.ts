import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { VisaType } from '@prisma/client';

export class SubmitVisaApplicationDto {
  @IsString()
  @MinLength(2)
  destinationCountry: string;

  @IsEnum(VisaType)
  visaType: VisaType;

  @IsOptional()
  @IsDateString()
  intendedTravelDate?: string;

  /** Omit to mean "this application is for the registering customer themself". */
  @IsOptional()
  @IsString()
  familyMemberId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // --- Phase 3 additions ---

  /**
   * Links this application to a VisaService catalog entry — enables the
   * richer workflow (costing snapshot, guarantor requirement, incentive
   * eligibility). Omit to keep the simpler Phase 2 flat-fee flow exactly
   * as it was.
   */
  @IsOptional()
  @IsString()
  visaServiceId?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  previousVisaInfo?: string;
}
