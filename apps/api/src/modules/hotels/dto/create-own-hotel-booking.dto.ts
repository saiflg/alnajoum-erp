import { IsString } from 'class-validator';

export class CreateOwnHotelBookingDto {
  @IsString()
  offerId: string;
}
