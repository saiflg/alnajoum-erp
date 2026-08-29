import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CreateOwnHotelBookingDto } from './dto/create-own-hotel-booking.dto';
import { HotelsService } from './hotels.service';

@Controller('hotels/bookings/me')
export class HotelBookingsOwnController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateOwnHotelBookingDto) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.hotelsService.createBooking(customerId, dto.offerId);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.hotelsService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.hotelsService.getBooking(id, customerId);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.hotelsService.cancelBooking(id, customerId);
  }
}
