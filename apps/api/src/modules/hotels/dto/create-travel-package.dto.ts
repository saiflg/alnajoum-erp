import { PackageComponentType, TravelPackageCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class PackageComponentDto {
  @IsEnum(PackageComponentType)
  type: PackageComponentType;

  @IsString()
  description: string;

  @IsInt()
  @Min(0)
  cost: number;

  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  flightBookingId?: string;

  @IsOptional()
  @IsString()
  hotelBookingId?: string;

  @IsOptional()
  @IsString()
  visaApplicationId?: string;
}

export class CreateTravelPackageDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(TravelPackageCategory)
  category?: TravelPackageCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  hajjPackageId?: string;

  @IsOptional()
  @IsString()
  umrahPackageId?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isOfflineEntry?: boolean;

  @IsOptional()
  @IsString()
  offlineReason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PackageComponentDto)
  components: PackageComponentDto[];
}
