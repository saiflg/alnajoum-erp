import { IsOptional, IsString } from 'class-validator';

export class RequestHotelRefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
