import { IsDateString, IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class SearchHotelsDto {
  @IsString()
  @MinLength(2)
  city: string;

  @IsDateString()
  checkInDate: string;

  @IsDateString()
  checkOutDate: string;

  @IsInt()
  @Min(1)
  @Max(10)
  rooms: number;

  @IsInt()
  @Min(1)
  @Max(30)
  guests: number;
}
