import { PilgrimType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRoomAllocationDto {
  @IsOptional()
  @IsString()
  hajjGroupId?: string;

  @IsOptional()
  @IsString()
  umrahGroupId?: string;

  @IsString()
  hotelName: string;

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
