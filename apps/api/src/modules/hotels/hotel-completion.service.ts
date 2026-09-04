import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HotelIncentivesService } from './hotel-incentives.service';

/**
 * Confirms a hotel booking is complete (spec #17's "payment confirmed,
 * booking completed" gate for the staff incentive) — the hotel-side
 * counterpart of FlightTicketingService.issueTicket. Requires the invoice
 * to already be PAID; never fires automatically from payment recording
 * itself, always this explicit staff action.
 */
@Injectable()
export class HotelCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly incentivesService: HotelIncentivesService,
  ) {}

  async complete(bookingId: string, staffId: string) {
    const booking = await this.prisma.hotelBooking.findUnique({
      where: { id: bookingId },
      include: { invoice: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === HotelBookingStatus.COMPLETED) {
      throw new ConflictException('This booking has already been completed');
    }
    if (booking.status !== HotelBookingStatus.CONFIRMED) {
      throw new ConflictException(
        `This booking is ${booking.status.toLowerCase()}, not confirmed — it must be confirmed before it can be completed`,
      );
    }
    if (!booking.invoice || booking.invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Payment has not been confirmed for this booking yet.',
      );
    }

    const updated = await this.prisma.hotelBooking.update({
      where: { id: bookingId },
      data: {
        status: HotelBookingStatus.COMPLETED,
        completedAt: new Date(),
        completedByStaffId: staffId,
      },
    });

    await this.incentivesService.createForCompletedBooking(updated);

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Your hotel voucher is ready — ${booking.bookingReference}`,
        `Your stay at ${booking.hotelName} is confirmed and your voucher is ready to download from your portal.`,
      );
    }

    return updated;
  }
}
