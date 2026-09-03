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
}
