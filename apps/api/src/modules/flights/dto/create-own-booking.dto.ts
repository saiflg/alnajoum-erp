import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreatePassengerDto } from './create-passenger.dto';

export class CreateOwnBookingDto {
  @IsString()
  offerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePassengerDto)
  passengers: CreatePassengerDto[];

  /** The price the customer last saw and agreed to (from search/revalidate)
   * — the client should always revalidate immediately before this call, but
   * this is a defense-in-depth cross-check on the server side too. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedPrice?: number;

  /** Client-generated, stable across a retried submission — prevents a
   * duplicate booking/charge if the request is sent twice (spec #9). */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
