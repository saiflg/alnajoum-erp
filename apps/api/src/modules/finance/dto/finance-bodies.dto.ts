import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateBankStatementLineDto } from './create-bank-statement-line.dto';

export class BulkBankStatementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CreateBankStatementLineDto)
  lines: CreateBankStatementLineDto[];
}

export class AccountReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason: string;
}

export class DailyClosingRequestDto {
  @IsOptional()
  @IsDateString()
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;
}
