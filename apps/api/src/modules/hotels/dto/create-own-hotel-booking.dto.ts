import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class HotelGuestDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  familyMemberId?: string;
}

export class CreateOwnHotelBookingDto {
  @IsString()
  offerId: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HotelGuestDto)
  guests?: HotelGuestDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
