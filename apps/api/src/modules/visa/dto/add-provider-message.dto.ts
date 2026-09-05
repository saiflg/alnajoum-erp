import { ProviderMessageSeverity } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class AddProviderMessageDto {
  @IsString()
  @MinLength(3)
  message: string;

  @IsOptional()
  @IsEnum(ProviderMessageSeverity)
  severity?: ProviderMessageSeverity;
}
