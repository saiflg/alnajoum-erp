import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFlightSupplierDto } from './dto/create-flight-supplier.dto';
import { UpdateFlightSupplierDto } from './dto/update-flight-supplier.dto';
import { FlightSuppliersService } from './flight-suppliers.service';

@Controller('flight-suppliers')
@RequirePermissions(PERMISSIONS.FLIGHT.SUPPLIER_MANAGE)
export class FlightSuppliersController {
  constructor(private readonly service: FlightSuppliersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listAll({ status });
  }

  @Post()
  create(@Body() dto: CreateFlightSupplierDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFlightSupplierDto) {
    return this.service.update(id, dto);
  }

  @Get(':id/balance')
  getBalance(@Param('id') id: string) {
    return this.service.getBalance(id);
  }
}
