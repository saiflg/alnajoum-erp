import { IsString } from 'class-validator';
import { CreateOwnVehicleRentalDto } from './create-own-vehicle-rental.dto';

/** Admin/staff variant: books on behalf of an explicit customer. */
export class CreateVehicleRentalDto extends CreateOwnVehicleRentalDto {
  @IsString()
  customerId: string;
}
