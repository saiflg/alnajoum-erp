import { IsString, Length } from 'class-validator';

export class TwoFactorVerifyDto {
  @IsString()
  @Length(6, 32) // 6-digit TOTP, or a XXXXX-XXXXX-XXXXX-XXXXX recovery code
  code: string;
}
