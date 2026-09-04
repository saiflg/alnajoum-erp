import { PilgrimCheckInEvent } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CheckInByCodeDto {
  @IsString()
  pilgrimCode: string;

  @IsEnum(PilgrimCheckInEvent)
  event: PilgrimCheckInEvent;

  @IsOptional()
  @IsString()
  location?: string;
}

export class CheckInDto {
  @IsEnum(PilgrimCheckInEvent)
  event: PilgrimCheckInEvent;

  @IsOptional()
  @IsString()
  location?: string;
}
