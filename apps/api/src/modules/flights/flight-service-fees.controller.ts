import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFlightServiceFeeDto } from './dto/create-flight-service-fee.dto';
import { UpdateFlightServiceFeeDto } from './dto/update-flight-service-fee.dto';
import { FlightServiceFeesService } from './flight-service-fees.service';

@Controller('flights/service-fees')
@RequirePermissions(PERMISSIONS.FLIGHT.PROVIDER_MANAGE)
export class FlightServiceFeesController {
  constructor(private readonly service: FlightServiceFeesService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@Body() dto: CreateFlightServiceFeeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFlightServiceFeeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
