import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Creates (or overwrites totalAllocated on) one HotelAllotment row per date
 * in [startDate, endDate] inclusive — the bulk entry path a hotelier
 * actually uses (spec's own "date-range" framing), rather than posting one
 * row at a time via CreateHotelAllotmentDto. */
export class BulkCreateHotelAllotmentDto {
  @IsString()
  roomTypeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsInt()
  @Min(0)
  totalAllocated: number;

  @IsOptional()
  @IsBoolean()
  stopSell?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
