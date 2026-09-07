import { IsString, Length } from 'class-validator';

export class TwoFactorVerifyDto {
  @IsString()
  @Length(6, 12) // 6-digit TOTP, or an XXXXX-XXXXX recovery code where accepted
  code: string;
}
