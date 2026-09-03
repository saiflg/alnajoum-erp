import { PartialType } from '@nestjs/mapped-types';
import { CreateCorporateAccountDto } from './create-corporate-account.dto';

export class UpdateCorporateAccountDto extends PartialType(
  CreateCorporateAccountDto,
) {}
