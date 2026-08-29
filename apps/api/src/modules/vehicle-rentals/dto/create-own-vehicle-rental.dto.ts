import { IsString } from 'class-validator';

export class CreateOwnVehicleRentalDto {
  @IsString()
  offerId: string;
}
