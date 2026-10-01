import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateHotelAllotmentDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAllocated?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  blockedCount?: number;

  @IsOptional()
  @IsBoolean()
  stopSell?: boolean;

  @IsOptional()
  @IsDateString()
  releaseDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
