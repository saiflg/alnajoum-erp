import { IsString, Length } from 'class-validator';

export class TwoFactorLoginVerifyDto {
  @IsString()
  challengeToken: string;

  @IsString()
  @Length(6, 12)
  code: string;
}
