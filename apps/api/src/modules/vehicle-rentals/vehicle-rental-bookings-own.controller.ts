import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CreateOwnVehicleRentalDto } from './dto/create-own-vehicle-rental.dto';
import { VehicleRentalsService } from './vehicle-rentals.service';

@Controller('vehicle-rentals/bookings/me')
export class VehicleRentalBookingsOwnController {
  constructor(
    private readonly vehicleRentalsService: VehicleRentalsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateOwnVehicleRentalDto) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.vehicleRentalsService.createBooking(customerId, dto.offerId);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.vehicleRentalsService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.vehicleRentalsService.getBooking(id, customerId);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.vehicleRentalsService.cancelBooking(id, customerId);
  }
}
