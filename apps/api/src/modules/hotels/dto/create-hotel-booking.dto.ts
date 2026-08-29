import { IsString } from 'class-validator';
import { CreateOwnHotelBookingDto } from './create-own-hotel-booking.dto';

/** Admin/staff variant: books on behalf of an explicit customer. */
export class CreateHotelBookingDto extends CreateOwnHotelBookingDto {
  @IsString()
  customerId: string;
}
