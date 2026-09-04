import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
