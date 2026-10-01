import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { BulkCreateHotelAllotmentDto } from './dto/bulk-create-hotel-allotment.dto';
import { CreateHotelAllotmentDto } from './dto/create-hotel-allotment.dto';
import { UpdateHotelAllotmentDto } from './dto/update-hotel-allotment.dto';
import { HotelAllotmentsService } from './hotel-allotments.service';

/** Phase 17 — day-level room allotment inventory for the CATALOG hotel
 * provider. Tenant-scoped exactly like RatePlansController. */
@RequireFeature('ENABLE_HOTELS')
@Controller('hotels/allotments')
@RequirePermissions(PERMISSIONS.HOTEL.ALLOTMENT_MANAGE)
export class HotelAllotmentsController {
  constructor(private readonly allotmentsService: HotelAllotmentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthContext,
    @Query('roomTypeId') roomTypeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.allotmentsService.list(
      { roomTypeId, from, to },
      resolveTenantFilter(user),
    );
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateHotelAllotmentDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to create an allotment for — sign in as a tenant admin instead.',
      );
    }
    return this.allotmentsService.create(dto, tenantCompanyId, user.sub);
  }

  @Post('bulk')
  bulkCreate(
    @CurrentUser() user: AuthContext,
    @Body() dto: BulkCreateHotelAllotmentDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to create an allotment for — sign in as a tenant admin instead.',
      );
    }
    return this.allotmentsService.bulkCreate(dto, tenantCompanyId, user.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateHotelAllotmentDto,
  ) {
    return this.allotmentsService.update(
      id,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }
}
