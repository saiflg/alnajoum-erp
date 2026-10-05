import { IsOptional, IsString } from 'class-validator';

export class UpdatePushTokenDto {
  @IsOptional()
  @IsString()
  pushToken?: string;

  @IsOptional()
  @IsString()
  pushProvider?: string;
}
