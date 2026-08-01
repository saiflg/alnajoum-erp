import { IsString } from 'class-validator';
import { CreateOwnBookingDto } from './create-own-booking.dto';

/** Admin/staff variant: books on behalf of an explicit customer. */
export class CreateBookingDto extends CreateOwnBookingDto {
  @IsString()
  customerId: string;
}
