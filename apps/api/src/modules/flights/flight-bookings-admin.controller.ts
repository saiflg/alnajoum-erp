import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FlightBookingStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FlightsService } from './flights.service';

@Controller('flights/bookings')
export class FlightBookingsAdminController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.FLIGHT.BOOK)
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateBookingDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.flightsService.createBooking(
      dto.customerId,
      dto.offerId,
      dto.passengers,
      staffId ?? undefined,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FLIGHT.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: FlightBookingStatus,
  ) {
    return this.flightsService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLIGHT.READ)
  findOne(@Param('id') id: string) {
    return this.flightsService.getBooking(id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FLIGHT.CANCEL)
  cancel(@Param('id') id: string) {
    return this.flightsService.cancelBooking(id);
  }
}
