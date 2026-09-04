import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { HotelBookingStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { RecordManualHotelBookingDto } from './dto/record-manual-hotel-booking.dto';
import { RequestHotelRefundDto } from './dto/request-hotel-refund.dto';
import { HotelCompletionService } from './hotel-completion.service';
import { HotelRefundsService } from './hotel-refunds.service';
import { HotelsService } from './hotels.service';

@Controller('hotels/bookings')
export class HotelBookingsAdminController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly usersService: UsersService,
    private readonly completionService: HotelCompletionService,
    private readonly refundsService: HotelRefundsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.HOTEL.BOOK)
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateHotelBookingDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.hotelsService.createBooking(
      dto.customerId,
      dto.offerId,
      staffId ?? undefined,
      dto.guests,
      dto.idempotencyKey,
    );
  }

  /** Manual/offline booking (spec #23) — clearly marked, always reasoned. */
  @Post('manual')
  @RequirePermissions(PERMISSIONS.HOTEL.BOOK)
  async createManual(
    @CurrentUser() user: AuthContext,
    @Body() dto: RecordManualHotelBookingDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can record a manual booking');
    }
    return this.hotelsService.createManualBooking(
      dto.customerId,
      dto.offerId,
      staffId,
      dto.offlineReason,
      dto.guests,
    );
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

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.HOTEL.COMPLETE)
  async complete(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.completionService.complete(id, staffId ?? '');
  }

  @Get(':id/refund-preview')
  @RequirePermissions(PERMISSIONS.HOTEL.REFUND)
  previewRefund(@Param('id') id: string) {
    return this.refundsService.previewRefund(id);
  }

  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.HOTEL.REFUND)
  async requestRefund(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequestHotelRefundDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.refundsService.requestRefund(id, {
      requestedByStaffId: staffId ?? undefined,
      reason: dto.reason,
    });
  }

  @Get(':id/refunds')
  @RequirePermissions(PERMISSIONS.HOTEL.READ)
  listRefunds(@Param('id') id: string) {
    return this.refundsService.listAll({ bookingId: id });
  }
}
