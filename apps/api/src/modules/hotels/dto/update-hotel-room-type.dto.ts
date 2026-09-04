import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateHotelRoomTypeDto } from './create-hotel-room-type.dto';

export class UpdateHotelRoomTypeDto extends PartialType(
  CreateHotelRoomTypeDto,
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
