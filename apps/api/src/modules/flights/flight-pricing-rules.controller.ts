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
import { CreateFlightPricingRuleDto } from './dto/create-flight-pricing-rule.dto';
import { UpdateFlightPricingRuleDto } from './dto/update-flight-pricing-rule.dto';
import { FlightPricingService } from './flight-pricing.service';

import { Roles } from '../../common/decorators/roles.decorator';
@Controller('flights/pricing-rules')
@RequirePermissions(PERMISSIONS.FLIGHT.PRICING_MANAGE)
export class FlightPricingRulesController {
  constructor(private readonly pricingService: FlightPricingService) {}

  @Get()
  list() {
    return this.pricingService.listRules();
  }

  @Roles('SUPER_ADMIN')
  @Post()
  create(@Body() dto: CreateFlightPricingRuleDto) {
    return this.pricingService.createRule(dto);
  }

  @Roles('SUPER_ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFlightPricingRuleDto) {
    return this.pricingService.updateRule(id, dto);
  }

  @Roles('SUPER_ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pricingService.deleteRule(id);
  }
}
