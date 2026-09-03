import { IsString, MinLength } from 'class-validator';

export class UpdateBankDetailsDto {
  @IsString()
  @MinLength(2)
  bankName: string;

  @IsString()
  @MinLength(4)
  bankAccountNumber: string;

  @IsString()
  @MinLength(2)
  bankAccountName: string;
}
