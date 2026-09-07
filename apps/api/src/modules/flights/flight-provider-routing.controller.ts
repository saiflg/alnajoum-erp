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

@Controller('flights/provider-routing-rules')
@RequirePermissions(PERMISSIONS.FLIGHT.PROVIDER_MANAGE)
export class FlightProviderRoutingController {
  constructor(private readonly service: FlightProviderRoutingService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@Body() dto: CreateFlightProviderRoutingRuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlightProviderRoutingRuleDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
