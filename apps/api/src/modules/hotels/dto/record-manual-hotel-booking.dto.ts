import { IsString } from 'class-validator';
import { CreateHotelBookingDto } from './create-hotel-booking.dto';

export class RecordManualHotelBookingDto extends CreateHotelBookingDto {
  @IsString()
  offlineReason: string;
}
