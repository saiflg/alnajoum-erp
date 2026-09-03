import { IsString, MinLength } from 'class-validator';

export class RejectIncentiveDto {
  @IsString()
  @MinLength(2)
  reason: string;
}
