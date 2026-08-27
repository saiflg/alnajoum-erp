import { PartialType } from '@nestjs/mapped-types';
import { PackageStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUmrahPackageDto } from './create-umrah-package.dto';

export class UpdateUmrahPackageDto extends PartialType(CreateUmrahPackageDto) {
  @IsOptional()
  @IsEnum(PackageStatus)
  status?: PackageStatus;
}
