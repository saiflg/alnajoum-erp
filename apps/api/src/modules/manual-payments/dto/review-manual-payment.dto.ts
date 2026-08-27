import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewManualPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
