import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { SubmitVisaApplicationDto } from './submit-visa-application.dto';

/**
 * Staff-only extension of SubmitVisaApplicationDto — these fields are
 * deliberately not on the base DTO the customer-facing controller uses, so
 * a customer can never mark their own application "offline" or exempt
 * themselves from a guarantor requirement.
 */
export class SubmitVisaApplicationForDto extends SubmitVisaApplicationDto {
  @IsOptional()
  @IsBoolean()
  isOfflineEntry?: boolean;

  /** Required when isOfflineEntry is true — see VisaService.submit(). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  offlineReason?: string;

  @IsOptional()
  @IsBoolean()
  guarantorExempt?: boolean;

  /** Required when guarantorExempt is true — see VisaService.submit(). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  guarantorExemptReason?: string;
}
