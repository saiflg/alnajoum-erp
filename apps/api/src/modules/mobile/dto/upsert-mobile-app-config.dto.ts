import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertMobileAppConfigDto {
  @IsString()
  minSupportedVersion: string;

  @IsString()
  recommendedVersion: string;

  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  maintenanceMessage?: string;
}
