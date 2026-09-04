import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CreateOwnBookingDto } from './dto/create-own-booking.dto';
import { RequestRefundDto } from './dto/request-refund.dto';
import { FlightRefundsService } from './flight-refunds.service';
import { FlightsService } from './flights.service';

type UnknownRecord = Record<string, unknown>;

/** Strips internal costing/routing fields a customer must never see — same
 * principle (and pattern) as visa-applications-own.controller.ts's
 * sanitizeForCustomer. providerCost/markupAmount are margin data; the rest
 * are internal routing/staff identifiers with no customer-facing meaning. */
function sanitizeForCustomer(booking: UnknownRecord): UnknownRecord {
  const {
    providerCost: _providerCost,
    markupAmount: _markupAmount,
    pricingRuleId: _pricingRuleId,
    providerOrderId: _providerOrderId,
    providerOfferId: _providerOfferId,
    ticketedByStaffId: _ticketedByStaffId,
    branchId: _branchId,
    idempotencyKey: _idempotencyKey,
    ...rest
  } = booking;
  return rest;
}

@Controller('flights/bookings/me')
export class FlightBookingsOwnController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly customersService: CustomersService,
    private readonly refundsService: FlightRefundsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateOwnBookingDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.flightsService.createBooking(
      customerId,
      dto.offerId,
      dto.passengers,
      undefined,
      dto.idempotencyKey,
      dto.expectedPrice,
    );
    return sanitizeForCustomer(booking);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const bookings = await this.flightsService.listForCustomer(customerId);
    return bookings.map((b) =>
      sanitizeForCustomer(b as unknown as UnknownRecord),
    );
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.flightsService.getBooking(id, customerId);
    return sanitizeForCustomer(booking);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const booking = await this.flightsService.cancelBooking(id, customerId);
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
    @Body() dto: RequestRefundDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    // Ownership check happens inside previewRefund/getBooking's
    // ownerCustomerId guard — requestRefund itself is staff-initiated in
    // shape (it doesn't take an ownerCustomerId param), so verify first.
    await this.refundsService.previewRefund(id, customerId);
    return this.refundsService.requestRefund(id, {
      requestedByCustomer: true,
      reason: dto.reason,
    });
  }
}
