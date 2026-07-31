import { DocumentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadDocumentQueryDto {
  @IsEnum(DocumentType)
  type: DocumentType;
}
