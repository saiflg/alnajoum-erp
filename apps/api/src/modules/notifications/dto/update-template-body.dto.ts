import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Editable fields of a message template (was an inline-typed body that bypassed validation). */
export class UpdateTemplateBodyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
