import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CorporateBookingStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CorporateTravelService } from './corporate-travel.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
@RequireFeature('ENABLE_CORPORATE_TRAVEL')
@Controller('corporate-travel/bookings')
export class CorporateBookingsController {
  constructor(
    private readonly corporateTravelService: CorporateTravelService,
  ) {}

  @TenantScoped({
    kind: 'corporateAccount',
    param: 'corporateAccountId',
    source: 'query',
  })
  @Get()
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  list(
    @CurrentUser() user: AuthContext,
    @Query('corporateAccountId') corporateAccountId?: string,
    @Query('status') status?: CorporateBookingStatus,
  ) {
    return this.corporateTravelService.listBookings(
      { corporateAccountId, status },
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('corporateBooking')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  findOne(@Param('id') id: string) {
    return this.corporateTravelService.getBooking(id);
  }

  @TenantScoped('corporateBooking')
  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  cancel(@Param('id') id: string) {
    return this.corporateTravelService.cancelBooking(id);
  }
}
