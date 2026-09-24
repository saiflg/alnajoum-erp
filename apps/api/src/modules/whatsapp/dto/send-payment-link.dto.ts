import { IsString } from 'class-validator';

export class SendPaymentLinkDto {
  @IsString()
  invoiceId: string;
}
