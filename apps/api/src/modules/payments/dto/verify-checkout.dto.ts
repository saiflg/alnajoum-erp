import { IsString, MinLength } from 'class-validator';

export class VerifyCheckoutDto {
  @IsString()
  @MinLength(1)
  reference: string;
}
