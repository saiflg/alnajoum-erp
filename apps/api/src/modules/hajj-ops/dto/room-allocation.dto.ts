import { PilgrimType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRoomAllocationDto {
  @IsOptional()
  @IsString()
  hajjGroupId?: string;

  @IsOptional()
  @IsString()
  umrahGroupId?: string;

  // Required unless hotelBookingId is given — when it is, the service
  // snapshots hotelName from that real booking instead of trusting
  // free-text input, so the two never disagree.
  @IsOptional()
  @IsString()
  hotelName?: string;

  // Links this room to a real Phase 5 HotelBooking the ops team made
  // through the hotel catalog for one of this group's pilgrims — optional,
  // since most packages still aren't booked through the catalog (see
  // schema.prisma's RoomAllocation comment).
  @IsOptional()
  @IsString()
  hotelBookingId?: string;

  @IsOptional()
  @IsString()
  roomType?: string;

  @IsString()
  roomNumber: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class AssignOccupantDto {
  @IsEnum(PilgrimType)
  pilgrimType: PilgrimType;

  @IsString()
  pilgrimId: string;
}
