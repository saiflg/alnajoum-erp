import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { RatePlansService } from './rate-plans.service';

/** Phase 17 — negotiated rate plans for the CATALOG hotel provider.
 * Tenant-scoped exactly like HotelCatalogController's sibling resources;
 * a Super Admin has no single tenant to attribute a new rate plan to. */
@RequireFeature('ENABLE_HOTELS')
@Controller('hotels/rate-plans')
export class RatePlansController {
  constructor(private readonly ratePlansService: RatePlansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.HOTEL.RATE_PLAN_MANAGE)
  list(
    @CurrentUser() user: AuthContext,
    @Query('roomTypeId') roomTypeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.ratePlansService.list(
      {
        roomTypeId,
        isActive: isActive === undefined ? undefined : isActive === 'true',
      },
      resolveTenantFilter(user),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.HOTEL.RATE_PLAN_MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateRatePlanDto) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to create a rate plan for — sign in as a tenant admin instead.',
      );
    }
    return this.ratePlansService.create(dto, tenantCompanyId, user.sub);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HOTEL.RATE_PLAN_MANAGE)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.ratePlansService.get(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.HOTEL.RATE_PLAN_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateRatePlanDto,
  ) {
    return this.ratePlansService.update(
      id,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.HOTEL.RATE_PLAN_MANAGE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.ratePlansService.remove(
      id,
      resolveTenantFilter(user),
      user.sub,
    );
  }
}
