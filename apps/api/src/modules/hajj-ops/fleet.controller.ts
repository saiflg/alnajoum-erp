import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DriverStatus, VehicleFleetStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  CreateDriverDto,
  CreateVehicleDto,
  UpdateDriverStatusDto,
  UpdateVehicleStatusDto,
} from './dto/fleet.dto';
import { FleetService } from './fleet.service';

@Controller('hajj-ops/fleet')
export class FleetController {
  constructor(private readonly service: FleetService) {}

  @Post('vehicles')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  createVehicle(@Body() dto: CreateVehicleDto) {
    return this.service.createVehicle(dto);
  }

  @Get('vehicles')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listVehicles(@Query('status') status?: VehicleFleetStatus) {
    return this.service.listVehicles(status);
  }

  @Patch('vehicles/:id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  updateVehicleStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleStatusDto,
  ) {
    return this.service.updateVehicleStatus(id, dto.status);
  }

  @Post('drivers')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  createDriver(@Body() dto: CreateDriverDto) {
    return this.service.createDriver(dto);
  }

  /** Non-sensitive list (no licenseNumber) — any group-view-level staff can see who's on shift. */
  @Get('drivers')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listDrivers(@Query('status') status?: DriverStatus) {
    return this.service.listDrivers(status);
  }

  /** Full detail including licenseNumber — sensitive, gated separately from the list above. */
  @Get('drivers/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.DRIVER_SENSITIVE_VIEW)
  getDriver(@Param('id') id: string) {
    return this.service.getDriver(id);
  }

  @Patch('drivers/:id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  updateDriverStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDriverStatusDto,
  ) {
    return this.service.updateDriverStatus(id, dto.status);
  }
}
