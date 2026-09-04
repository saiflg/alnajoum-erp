import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingStatus, HotelRefundStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from '../payments/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface HotelRefundPreview {
  bookingPrice: number;
  estimatedSupplierPenalty: number;
  agencyFee: number;
  estimatedRefundAmount: number;
  currency: string;
  freeCancellationDeadline: string;
}

/**
 * Cancellation/refund workflow (spec #9/#10) — never assumes a booking is
 * fully refundable:
 *
 *   refundAmount = bookingPrice − supplierPenalty − agencyFee
 *
 * Cancellation conditions are policy-based rather than a live provider
 * call (no hotel provider abstraction in this codebase exposes a real
 * refund-quote API the way Duffel does for flights): a configurable
 * "free cancellation window" measured in days before check-in, and a flat
 * penalty percentage once that window has passed — both set at
 * /admin/integrations, never hard-coded.
 */
@Injectable()
export class HotelRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  private async policyConfig(): Promise<{
    freeCancellationDays: number;
    cancellationPenaltyPercent: number;
    agencyFeePercent: number;
  }> {
    const config = await this.integrationsService.getCredentialConfig(
      'HOTEL',
      'mock',
    );
    return {
      freeCancellationDays: Number(config?.freeCancellationDays) || 0,
      cancellationPenaltyPercent:
        Number(config?.cancellationPenaltyPercent) || 0,
      agencyFeePercent: Number(config?.agencyFeePercent) || 0,
    };
  }

  private async getBooking(bookingId: string, ownerCustomerId?: string) {
    const booking = await this.prisma.hotelBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (ownerCustomerId && booking.customerId !== ownerCustomerId) {
      throw new BadRequestException(
        'This booking does not belong to this customer',
      );
    }
    return booking;
  }

  async previewRefund(
    bookingId: string,
    ownerCustomerId?: string,
  ): Promise<HotelRefundPreview> {
    const booking = await this.getBooking(bookingId, ownerCustomerId);
    const policy = await this.policyConfig();

    const deadline = new Date(booking.checkInDate);
    deadline.setDate(deadline.getDate() - policy.freeCancellationDays);
    const withinFreeWindow = new Date() < deadline;

    const agencyFee = Math.round(
      booking.totalAmount * (policy.agencyFeePercent / 100),
    );
    const estimatedSupplierPenalty = withinFreeWindow
      ? 0
      : Math.round(
          booking.totalAmount * (policy.cancellationPenaltyPercent / 100),
        );
    const estimatedRefundAmount = Math.max(
      0,
      booking.totalAmount - estimatedSupplierPenalty - agencyFee,
    );

    return {
      bookingPrice: booking.totalAmount,
      estimatedSupplierPenalty,
      agencyFee,
      estimatedRefundAmount,
      currency: booking.currency,
      freeCancellationDeadline: deadline.toISOString(),
    };
  }

  async requestRefund(
    bookingId: string,
    opts: {
      requestedByStaffId?: string;
      requestedByCustomer?: boolean;
      reason?: string;
    },
  ) {
    const booking = await this.getBooking(bookingId);
    if (
      booking.status === HotelBookingStatus.REFUNDED ||
      booking.status === HotelBookingStatus.CANCELLED
    ) {
      throw new ConflictException(
        'This booking has already been cancelled/refunded',
      );
    }

    const preview = await this.previewRefund(bookingId);

    const [refund] = await this.prisma.$transaction([
      this.prisma.hotelRefund.create({
        data: {
          bookingId,
          requestedByStaffId: opts.requestedByStaffId,
          requestedByCustomer: opts.requestedByCustomer ?? false,
          bookingPrice: preview.bookingPrice,
          supplierPenalty: preview.estimatedSupplierPenalty,
          agencyFee: preview.agencyFee,
          refundAmount: preview.estimatedRefundAmount,
          currency: preview.currency,
          status: HotelRefundStatus.COMPLETED,
          reason: opts.reason,
          completedAt: new Date(),
        },
      }),
      this.prisma.hotelBooking.update({
        where: { id: bookingId },
        data: { status: HotelBookingStatus.REFUNDED },
      }),
    ]);

    await this.invoicesService.voidHotelBookingIfUnpaid(bookingId);

    await this.auditService.record({
      action: 'hotel_refund.completed',
      entityType: 'HotelRefund',
      entityId: refund.id,
      metadata: { bookingId, refundAmount: preview.estimatedRefundAmount },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: booking.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Refund completed — ${booking.bookingReference}`,
        `Your refund of ${preview.currency} ${preview.estimatedRefundAmount} for booking ${booking.bookingReference} has been completed.`,
      );
    }

    return refund;
  }

  listAll(filters: { bookingId?: string; status?: HotelRefundStatus }) {
    return this.prisma.hotelRefund.findMany({
      where: filters,
      include: {
        booking: { select: { bookingReference: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
