import { PartialType } from '@nestjs/mapped-types';
import { PackageStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateHajjPackageDto } from './create-hajj-package.dto';

export class UpdateHajjPackageDto extends PartialType(CreateHajjPackageDto) {
  @IsOptional()
  @IsEnum(PackageStatus)
  status?: PackageStatus;
}
