import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateHotelAllotmentDto {
  @IsString()
  roomTypeId: string;

  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  totalAllocated: number;

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
