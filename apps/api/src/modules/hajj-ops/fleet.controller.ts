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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
@Controller('hajj-ops/fleet')
export class FleetController {
  constructor(private readonly service: FleetService) {}

  @Post('vehicles')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  createVehicle(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.service.createVehicle(dto, user.companyId ?? undefined);
  }

  @Get('vehicles')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listVehicles(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: VehicleFleetStatus,
  ) {
    return this.service.listVehicles(status, resolveTenantFilter(user));
  }

  @TenantScoped('vehicle')
  @Patch('vehicles/:id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  updateVehicleStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleStatusDto,
  ) {
    return this.service.updateVehicleStatus(id, dto.status);
  }

  @TenantScoped({ kind: 'vehicle', param: 'vehicleId', source: 'body' })
  @Post('drivers')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  createDriver(@CurrentUser() user: AuthContext, @Body() dto: CreateDriverDto) {
    return this.service.createDriver(dto, user.companyId ?? undefined);
  }

  /** Non-sensitive list (no licenseNumber) — any group-view-level staff can see who's on shift. */
  @Get('drivers')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listDrivers(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: DriverStatus,
  ) {
    return this.service.listDrivers(status, resolveTenantFilter(user));
  }

  /** Full detail including licenseNumber — sensitive, gated separately from the list above. */
  @TenantScoped('driver')
  @Get('drivers/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.DRIVER_SENSITIVE_VIEW)
  getDriver(@Param('id') id: string) {
    return this.service.getDriver(id);
  }

  @TenantScoped('driver')
  @Patch('drivers/:id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.FLEET_MANAGE)
  updateDriverStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDriverStatusDto,
  ) {
    return this.service.updateDriverStatus(id, dto.status);
  }
}
