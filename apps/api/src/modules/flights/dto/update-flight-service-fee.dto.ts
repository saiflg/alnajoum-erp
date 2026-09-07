import { PartialType } from '@nestjs/mapped-types';
import { CreateFlightServiceFeeDto } from './create-flight-service-fee.dto';

export class UpdateFlightServiceFeeDto extends PartialType(
  CreateFlightServiceFeeDto,
) {}
