import { ReadinessStatus } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class OverrideReadinessDto {
  @IsEnum(ReadinessStatus)
  status: ReadinessStatus;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
