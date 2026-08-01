import { PassengerType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreatePassengerDto {
  @IsEnum(PassengerType)
  type: PassengerType;

  /** Omit to mean "this passenger is the booking's own customer". */
  @IsOptional()
  @IsString()
  familyMemberId?: string;
}
