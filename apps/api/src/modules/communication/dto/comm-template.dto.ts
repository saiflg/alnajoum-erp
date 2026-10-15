import { Transform } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTemplateDto {
  @Matches(/^[a-z][a-z0-9_]{2,40}$/, {
    message:
      'key: lower-case letters, digits and underscores, 3 to 41 characters',
  })
  key!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsIn(['WHATSAPP', 'EMAIL']) channel!: 'WHATSAPP' | 'EMAIL';
  @IsIn(['MARKETING', 'UTILITY', 'TRANSACTIONAL']) category!:
    'MARKETING' | 'UTILITY' | 'TRANSACTIONAL';
  @IsIn(['en', 'ha', 'ar']) language!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyHtml?: string;
  @IsString() @MinLength(1) @MaxLength(20_000) bodyText!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  whatsappTemplateName?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
  @IsOptional() @IsIn(['MARKETING', 'UTILITY', 'TRANSACTIONAL']) category?:
    'MARKETING' | 'UTILITY' | 'TRANSACTIONAL';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyHtml?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20_000) bodyText?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  whatsappTemplateName?: string;
  @IsOptional() isActive?: boolean;
}

export class PreviewTemplateDto {
  @IsOptional() @IsObject() values?: Record<string, string>;
}

export class ListTemplatesQueryDto {
  @IsOptional() @IsIn(['WHATSAPP', 'EMAIL']) channel?: 'WHATSAPP' | 'EMAIL';
  @IsOptional()
  @IsIn(['MARKETING', 'UTILITY', 'TRANSACTIONAL'])
  category?: string;
  @IsOptional() @IsIn(['true', 'false']) includeInactive?: string;
}

export class TestEmailDto {
  @Transform(trim) @IsString() @MaxLength(254) to!: string;
}

export class TestWhatsAppDto {
  @Transform(trim) @IsString() @MaxLength(40) to!: string;
}
