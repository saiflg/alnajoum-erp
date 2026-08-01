import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CreateOwnBookingDto } from './dto/create-own-booking.dto';
import { FlightsService } from './flights.service';

@Controller('flights/bookings/me')
export class FlightBookingsOwnController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateOwnBookingDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.flightsService.createBooking(
      customerId,
      dto.offerId,
      dto.passengers,
    );
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.flightsService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.flightsService.getBooking(id, customerId);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.flightsService.cancelBooking(id, customerId);
  }
}
