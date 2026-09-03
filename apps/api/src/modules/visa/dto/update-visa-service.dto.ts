import { PartialType } from '@nestjs/mapped-types';
import { CreateVisaServiceDto } from './create-visa-service.dto';

export class UpdateVisaServiceDto extends PartialType(CreateVisaServiceDto) {}
