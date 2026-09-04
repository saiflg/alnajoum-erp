import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FlightGroupBookingStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateFlightGroupBookingDto } from './dto/create-flight-group-booking.dto';
import { FlightGroupBookingsService } from './flight-group-bookings.service';

@Controller('flights/group-bookings')
@RequirePermissions(PERMISSIONS.FLIGHT.GROUP_MANAGE)
export class FlightGroupBookingsController {
  constructor(
    private readonly groupBookingsService: FlightGroupBookingsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateFlightGroupBookingDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.groupBookingsService.create(dto, staffId ?? undefined);
  }

  @Get()
  list(@Query('status') status?: FlightGroupBookingStatus) {
    return this.groupBookingsService.listAll({ status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.groupBookingsService.get(id);
  }

  @Post(':id/payment')
  recordPayment(@Param('id') id: string, @Body('amount') amount: number) {
    return this.groupBookingsService.recordPayment(id, Number(amount));
  }

  @Post(':id/manifest')
  importManifest(
    @Param('id') id: string,
    @Body('passengers')
    passengers: Array<{
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      passportNumber?: string;
    }>,
  ) {
    return this.groupBookingsService.importManifest(id, passengers);
  }
}
