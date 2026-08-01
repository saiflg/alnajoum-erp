import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreatePassengerDto } from './create-passenger.dto';

export class CreateOwnBookingDto {
  @IsString()
  offerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePassengerDto)
  passengers: CreatePassengerDto[];
}
