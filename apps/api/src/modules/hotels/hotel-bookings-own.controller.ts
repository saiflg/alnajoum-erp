import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CreateOwnHotelBookingDto } from './dto/create-own-hotel-booking.dto';
import { RequestHotelRefundDto } from './dto/request-hotel-refund.dto';
import { HotelRefundsService } from './hotel-refunds.service';
import { HotelsService } from './hotels.service';

type UnknownRecord = Record<string, unknown>;

/** Strips internal costing/routing fields — same principle/pattern as
 * flight-bookings-own.controller.ts's sanitizeForCustomer. supplierCost/
 * markupAmount are margin data a customer must never see. */
function sanitizeForCustomer(booking: UnknownRecord): UnknownRecord {
  const {
    supplierCost: _supplierCost,
    markupAmount: _markupAmount,
    providerOrderId: _providerOrderId,
    providerOfferId: _providerOfferId,
    completedByStaffId: _completedByStaffId,
    branchId: _branchId,
    idempotencyKey: _idempotencyKey,
    ...rest
  } = booking;
  return rest;
}

@Controller('hotels/bookings/me')
export class HotelBookingsOwnController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly customersService: CustomersService,
    private readonly refundsService: HotelRefundsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateOwnHotelBookingDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.hotelsService.createBooking(
      customerId,
      dto.offerId,
      undefined,
      dto.guests,
      dto.idempotencyKey,
    );
    return sanitizeForCustomer(booking);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const bookings = await this.hotelsService.listForCustomer(customerId);
    return bookings.map((b) =>
      sanitizeForCustomer(b as unknown as UnknownRecord),
    );
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.hotelsService.getBooking(id, customerId);
    return sanitizeForCustomer(booking);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.hotelsService.cancelBooking(id, customerId);
    return sanitizeForCustomer(booking);
  }

  @Get(':id/refund-preview')
  async previewRefund(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.refundsService.previewRefund(id, customerId);
  }

  @Post(':id/refund-request')
  async requestRefund(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequestHotelRefundDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.refundsService.previewRefund(id, customerId); // ownership check
    return this.refundsService.requestRefund(id, {
      requestedByCustomer: true,
      reason: dto.reason,
    });
  }
}
