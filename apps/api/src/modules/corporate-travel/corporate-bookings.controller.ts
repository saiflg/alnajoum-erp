import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CorporateBookingStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CorporateTravelService } from './corporate-travel.service';

@Controller('corporate-travel/bookings')
export class CorporateBookingsController {
  constructor(
    private readonly corporateTravelService: CorporateTravelService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  list(
    @Query('corporateAccountId') corporateAccountId?: string,
    @Query('status') status?: CorporateBookingStatus,
  ) {
    return this.corporateTravelService.listBookings({
      corporateAccountId,
      status,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  findOne(@Param('id') id: string) {
    return this.corporateTravelService.getBooking(id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  cancel(@Param('id') id: string) {
    return this.corporateTravelService.cancelBooking(id);
  }
}
