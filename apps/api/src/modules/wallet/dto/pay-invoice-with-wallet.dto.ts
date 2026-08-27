import { IsInt, IsString, Max, Min } from 'class-validator';

export class PayInvoiceWithWalletDto {
  @IsString()
  invoiceId: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;
}
