import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UploadSupplierDocumentQueryDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
