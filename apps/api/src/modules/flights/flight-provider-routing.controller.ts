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
import { CreateFlightProviderRoutingRuleDto } from './dto/create-flight-provider-routing-rule.dto';
import { UpdateFlightProviderRoutingRuleDto } from './dto/update-flight-provider-routing-rule.dto';
import { FlightProviderRoutingService } from './flight-provider-routing.service';

import { Roles } from '../../common/decorators/roles.decorator';
@Controller('flights/provider-routing-rules')
@RequirePermissions(PERMISSIONS.FLIGHT.PROVIDER_MANAGE)
export class FlightProviderRoutingController {
  constructor(private readonly service: FlightProviderRoutingService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Roles('SUPER_ADMIN')
  @Post()
  create(@Body() dto: CreateFlightProviderRoutingRuleDto) {
    return this.service.create(dto);
  }

  @Roles('SUPER_ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlightProviderRoutingRuleDto,
  ) {
    return this.service.update(id, dto);
  }

  @Roles('SUPER_ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
