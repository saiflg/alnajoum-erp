import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CreateFeatureFlagDto {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'key must be SCREAMING_SNAKE_CASE, e.g. ENABLE_HAJJ',
  })
  key: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isEnabledByDefault?: boolean;
}
