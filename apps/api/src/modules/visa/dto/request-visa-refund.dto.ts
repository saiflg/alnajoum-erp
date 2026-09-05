import { IsOptional, IsString, MinLength } from 'class-validator';

export class RequestVisaRefundDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;
}
