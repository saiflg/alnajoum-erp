import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UmrahPilgrimInputDto {
  /** Omit to mean "this pilgrim is the registering customer". */
  @IsOptional()
  @IsString()
  familyMemberId?: string;
}

export class RegisterUmrahDto {
  @IsString()
  packageId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UmrahPilgrimInputDto)
  pilgrims: UmrahPilgrimInputDto[];
}
