import { PromotionMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePromotionDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, {
    message: 'code must be 3-32 letters, digits, - or _',
  })
  code?: string;

  @IsEnum(PromotionMode) mode: PromotionMode;

  @IsInt() @Min(1) value: number;

  @Type(() => Date) @IsDate() startsAt: Date;
  @Type(() => Date) @IsDate() endsAt: Date;

  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) products?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
  @IsOptional() @IsInt() @Min(0) minBookingAmount?: number;
  @IsOptional() @IsInt() @Min(1) maxDiscountAmount?: number;
  @IsOptional() @IsInt() @Min(1) totalUsageLimit?: number;
  @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
  @IsOptional() @IsInt() @Min(1) budget?: number;
}
