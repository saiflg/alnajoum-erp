import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FlightAncillaryStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchaseFlightAncillaryDto } from './dto/purchase-flight-ancillary.dto';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type { FlightProviderPort } from './providers/flight-provider.port';

/**
 * Phase 10 spec #19 — baggage/seat/meal/other add-ons, recorded separately
 * from the base fare (FlightBooking.totalAmount is never touched) so
 * accounting/reporting can tell ticket revenue and ancillary revenue
 * apart, per the spec's own instruction. Price is shown before purchase —
 * the provider's own quote (mock or real), never invented locally.
 */
@Injectable()
export class FlightAncillariesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly auditService: AuditService,
  ) {}

  private async getBooking(bookingId: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  listForBooking(bookingId: string) {
    return this.prisma.flightAncillary.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async purchase(
    bookingId: string,
    dto: PurchaseFlightAncillaryDto,
    staffId?: string,
  ) {
    const booking = await this.getBooking(bookingId);
    const capabilities = await this.provider.capabilities();

    if (!capabilities.ancillary || !booking.providerOrderId) {
      const manual = await this.prisma.flightAncillary.create({
        data: {
          bookingId,
          type: dto.type,
          description: dto.description,
          amount: 0,
          currency: booking.currency,
          status: FlightAncillaryStatus.REQUESTED,
          purchasedByStaffId: staffId,
        },
      });
      await this.auditService.record({
        action: 'flight_ancillary.manual_required',
        entityType: 'FlightAncillary',
        entityId: manual.id,
        metadata: { bookingId, type: dto.type },
      });
      return manual;
    }

    const result = await this.provider.purchaseAncillary(
      booking.providerOrderId,
      dto,
    );

    const ancillary = await this.prisma.flightAncillary.create({
      data: {
        bookingId,
        type: dto.type,
        description: dto.description,
        amount: result.amount,
        currency: result.currency,
        status:
          result.status === 'CONFIRMED'
            ? FlightAncillaryStatus.CONFIRMED
            : FlightAncillaryStatus.FAILED,
        purchasedByStaffId: staffId,
        providerReference: result.providerReference,
      },
    });

    await this.auditService.record({
      action:
        result.status === 'CONFIRMED'
          ? 'flight_ancillary.purchased'
          : 'flight_ancillary.failed',
      entityType: 'FlightAncillary',
      entityId: ancillary.id,
      metadata: { bookingId, type: dto.type, amount: result.amount },
    });

    return ancillary;
  }
}
