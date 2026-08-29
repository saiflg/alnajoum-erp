import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VehicleRentalStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateVehicleRentalDto } from './dto/create-vehicle-rental.dto';
import { VehicleRentalsService } from './vehicle-rentals.service';

@Controller('vehicle-rentals/bookings')
export class VehicleRentalBookingsAdminController {
  constructor(
    private readonly vehicleRentalsService: VehicleRentalsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.VEHICLE_RENTAL.BOOK)
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateVehicleRentalDto) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.vehicleRentalsService.createBooking(
      dto.customerId,
      dto.offerId,
      staffId ?? undefined,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VEHICLE_RENTAL.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: VehicleRentalStatus,
  ) {
    return this.vehicleRentalsService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VEHICLE_RENTAL.READ)
  findOne(@Param('id') id: string) {
    return this.vehicleRentalsService.getBooking(id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.VEHICLE_RENTAL.CANCEL)
  cancel(@Param('id') id: string) {
    return this.vehicleRentalsService.cancelBooking(id);
  }
}
