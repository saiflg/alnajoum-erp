import { IsIn, IsString } from 'class-validator';

export class MatchBankStatementLineDto {
  @IsIn(['PAYMENT', 'EXPENSE', 'SUPPLIER_PAYMENT', 'STAFF_PAYOUT'])
  matchedType: 'PAYMENT' | 'EXPENSE' | 'SUPPLIER_PAYMENT' | 'STAFF_PAYOUT';

  @IsString()
  matchedId: string;
}
