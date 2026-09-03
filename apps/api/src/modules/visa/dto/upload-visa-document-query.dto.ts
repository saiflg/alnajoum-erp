import { DocumentType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class UploadVisaDocumentQueryDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
