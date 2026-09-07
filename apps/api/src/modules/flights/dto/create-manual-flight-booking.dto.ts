import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '@prisma/client';

export class ManualFlightPassengerDto {
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

  @IsOptional()
  @IsString()
  ticketNumber?: string;
}

/**
 * Phase 10 spec #40 — manual/offline flight booking. Staff enters what
 * actually happened (an offline transaction with an airline/agent) rather
 * than the system fabricating a provider order — see FlightsService.
 * createManualBooking's own doc comment for how this stays isolated from
 * every live-provider assumption elsewhere in the module.
 */
export class CreateManualFlightBookingDto {
  @IsString()
  customerId: string;

  @IsString()
  @MinLength(2)
  airline: string;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @IsString()
  origin: string;

  @IsString()
  destination: string;

  @IsDateString()
  departureAt: string;

  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManualFlightPassengerDto)
  passengers: ManualFlightPassengerDto[];

  @IsOptional()
  @IsString()
  pnr?: string;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsInt()
  @Min(0)
  companyCost: number;

  @IsInt()
  @Min(0)
  sellingPrice: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsIn(['CONFIRMED', 'TICKETED'])
  status: 'CONFIRMED' | 'TICKETED';

  @IsString()
  @MinLength(5)
  offlineReason: string;
}
