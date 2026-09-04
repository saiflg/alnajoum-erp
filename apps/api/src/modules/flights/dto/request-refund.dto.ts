import { IsOptional, IsString } from 'class-validator';

export class RequestRefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
