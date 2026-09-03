import { VisaApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateVisaStatusDto {
  @IsEnum(VisaApplicationStatus)
  status: VisaApplicationStatus;

  @IsOptional()
  @IsString()
  staffNote?: string;
}
