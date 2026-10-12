import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSegmentDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;
  @IsOptional() @IsIn(['DYNAMIC', 'STATIC']) kind?: 'DYNAMIC' | 'STATIC';
  /** Checked field by field by the service; unknown fields are refused. */
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
}

export class UpdateSegmentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
}

export class PreviewSegmentDto {
  @IsObject() definition!: Record<string, unknown>;
  @IsIn(['WHATSAPP', 'EMAIL']) channel!: 'WHATSAPP' | 'EMAIL';
  @IsOptional() @IsString() @MaxLength(40) topic?: string;
}

export class SegmentMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  contactIds!: string[];
}
