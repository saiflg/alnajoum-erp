import { IsBoolean } from 'class-validator';

export class SetFeatureFlagOverrideDto {
  @IsBoolean()
  isEnabled: boolean;
}
