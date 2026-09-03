import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CorporateBookingTravelerInputDto {
  @IsString()
  travelerId: string;

  @IsString()
  @MinLength(1)
  description: string;

  @IsInt()
  @Min(1)
  amount: number;
}

export class CreateCorporateBookingDto {
  @IsString()
  @MinLength(2)
  description: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CorporateBookingTravelerInputDto)
  travelers: CorporateBookingTravelerInputDto[];
}
