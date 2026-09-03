import { VisaDocumentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReviewVisaDocumentDto {
  @IsEnum(VisaDocumentStatus)
  status: VisaDocumentStatus;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
