import { DocumentType } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateChecklistExceptionDto {
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  @MinLength(5)
  reason: string;
}
