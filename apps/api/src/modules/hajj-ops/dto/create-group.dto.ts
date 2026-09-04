import { TravelGroupStatus, UmrahGroupType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateHajjGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  packageId?: string;

  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @IsOptional()
  @IsString()
  airline?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;

  @IsOptional()
  @IsString()
  coordinatorStaffId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateUmrahGroupDto extends CreateHajjGroupDto {
  @IsOptional()
  @IsEnum(UmrahGroupType)
  groupType?: UmrahGroupType;
}

export class UpdateGroupStatusDto {
  @IsEnum(TravelGroupStatus)
  status: TravelGroupStatus;
}
