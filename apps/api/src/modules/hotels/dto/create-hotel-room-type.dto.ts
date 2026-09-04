import { MealPlan } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateHotelRoomTypeDto {
  @IsString()
  name: string;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsOptional()
  @IsString()
  bedType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberOfBeds?: number;

  @IsOptional()
  @IsEnum(MealPlan)
  mealPlan?: MealPlan;

  @IsInt()
  @Min(0)
  supplierCost: number;

  @IsInt()
  @Min(0)
  sellingPrice: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalRooms?: number;

  @IsOptional()
  @IsString()
  cancellationRules?: string;
}
