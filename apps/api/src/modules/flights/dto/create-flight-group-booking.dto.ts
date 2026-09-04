import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class GroupPassengerDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  passportNumber?: string;
}

export class CreateFlightGroupBookingDto {
  @IsString()
  groupName: string;

  @IsString()
  groupContactName: string;

  @IsString()
  groupContactPhone: string;

  @IsOptional()
  @IsEmail()
  groupContactEmail?: string;

  @IsInt()
  @Min(1)
  numberOfPassengers: number;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsString()
  destination: string;

  @IsDateString()
  travelDate: string;

  @IsOptional()
  @IsString()
  airline?: string;

  @IsInt()
  @Min(0)
  negotiatedPrice: number;

  @IsString()
  currency: string;

  @IsInt()
  @Min(0)
  deposit: number;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => GroupPassengerDto)
  passengers?: GroupPassengerDto[];
}
