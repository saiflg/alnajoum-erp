import { MobilePlatform } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  deviceId: string;

  @IsEnum(MobilePlatform)
  platform: MobilePlatform;

  @IsString()
  appVersion: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  pushToken?: string;

  @IsOptional()
  @IsString()
  pushProvider?: string;
}
