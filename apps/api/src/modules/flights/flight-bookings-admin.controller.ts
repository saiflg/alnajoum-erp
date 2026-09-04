import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FlightBookingStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RequestRefundDto } from './dto/request-refund.dto';
import { RequestReissueDto } from './dto/request-reissue.dto';
import { FlightRefundsService } from './flight-refunds.service';
import { FlightReissueService } from './flight-reissue.service';
import { FlightTicketingService } from './flight-ticketing.service';
import { FlightsService } from './flights.service';

@Controller('flights/bookings')
export class FlightBookingsAdminController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly usersService: UsersService,
    private readonly ticketingService: FlightTicketingService,
    private readonly refundsService: FlightRefundsService,
    private readonly reissueService: FlightReissueService,
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
      dto.idempotencyKey,
      dto.expectedPrice,
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

  @Post(':id/ticket')
  @RequirePermissions(PERMISSIONS.FLIGHT.TICKET_ISSUE)
  async issueTicket(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.ticketingService.issueTicket(id, staffId ?? '');
  }

  @Get(':id/refund-preview')
  @RequirePermissions(PERMISSIONS.FLIGHT.REFUND)
  previewRefund(@Param('id') id: string) {
    return this.refundsService.previewRefund(id);
  }

  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.FLIGHT.REFUND)
  async requestRefund(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequestRefundDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.refundsService.requestRefund(id, {
      requestedByStaffId: staffId ?? undefined,
      reason: dto.reason,
    });
  }

  @Post(':id/reissue')
  @RequirePermissions(PERMISSIONS.FLIGHT.REISSUE)
  async requestReissue(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequestReissueDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.reissueService.requestReissue(
      id,
      dto.newOfferId,
      staffId ?? undefined,
    );
  }

  @Post('reissues/:reissueId/complete')
  @RequirePermissions(PERMISSIONS.FLIGHT.REISSUE)
  async completeReissue(
    @CurrentUser() user: AuthContext,
    @Param('reissueId') reissueId: string,
    @Body('manualPnr') manualPnr?: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.reissueService.completeReissue(
      reissueId,
      staffId ?? '',
      manualPnr,
    );
  }

  @Get(':id/reissues')
  @RequirePermissions(PERMISSIONS.FLIGHT.READ)
  listReissues(@Param('id') id: string) {
    return this.reissueService.listAll({ bookingId: id });
  }

  @Get(':id/refunds')
  @RequirePermissions(PERMISSIONS.FLIGHT.READ)
  listRefunds(@Param('id') id: string) {
    return this.refundsService.listAll({ bookingId: id });
  }
}
