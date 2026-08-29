import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HotelBookingStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelsService } from './hotels.service';

@Controller('hotels/bookings')
export class HotelBookingsAdminController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.HOTEL.BOOK)
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateHotelBookingDto) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.hotelsService.createBooking(dto.customerId, dto.offerId, staffId ?? undefined);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.HOTEL.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: HotelBookingStatus,
  ) {
    return this.hotelsService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HOTEL.READ)
  findOne(@Param('id') id: string) {
    return this.hotelsService.getBooking(id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.HOTEL.CANCEL)
  cancel(@Param('id') id: string) {
    return this.hotelsService.cancelBooking(id);
  }
}
