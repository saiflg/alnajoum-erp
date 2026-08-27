import { IsString, MaxLength } from 'class-validator';

export class VerifyWalletCheckoutDto {
  @IsString()
  @MaxLength(100)
  reference: string;
}
