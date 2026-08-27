import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class HajjPilgrimInputDto {
  /** Omit to mean "this pilgrim is the registering customer". */
  @IsOptional()
  @IsString()
  familyMemberId?: string;
}

export class RegisterHajjDto {
  @IsString()
  packageId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HajjPilgrimInputDto)
  pilgrims: HajjPilgrimInputDto[];
}
