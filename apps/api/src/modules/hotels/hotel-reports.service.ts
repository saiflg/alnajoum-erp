import { Injectable } from '@nestjs/common';
import { HotelBookingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface HotelFilters {
  from?: Date;
  to?: Date;
  branchId?: string;
  staffId?: string;
}

/** Hotel Admin Dashboard (spec #20) — revenue/cost/markup/margin/refunds/
 * cancellations/incentives, plus popular-destination and popular-hotel
 * breakdowns computed from the same booking rows. */
@Injectable()
export class HotelReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(filters: HotelFilters) {
    return {
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.staffId ? { bookedByStaffId: filters.staffId } : {}),
    };
  }

  async kpis(filters: HotelFilters) {
    const where = this.where(filters);
    const bookings = await this.prisma.hotelBooking.findMany({ where });

    const completed = bookings.filter(
      (b) => b.status === HotelBookingStatus.COMPLETED,
    );
    const cancelled = bookings.filter(
      (b) => b.status === HotelBookingStatus.CANCELLED,
    ).length;
    const revenue = completed.reduce((s, b) => s + b.totalAmount, 0);
    const supplierCost = completed.reduce(
      (s, b) => s + (b.supplierCost ?? 0),
      0,
    );
    const markup = completed.reduce((s, b) => s + (b.markupAmount ?? 0), 0);

    const bookingIds = bookings.map((b) => b.id);
    const refunds = await this.prisma.hotelRefund.count({
      where: { bookingId: { in: bookingIds } },
    });
    const staffIncentivesAgg = await this.prisma.staffIncentive.aggregate({
      where: { sourceType: 'HOTEL_BOOKING', sourceId: { in: bookingIds } },
      _sum: { amount: true },
    });

    const cityCounts = new Map<string, number>();
    const hotelCounts = new Map<string, number>();
    for (const b of bookings) {
      cityCounts.set(b.city, (cityCounts.get(b.city) ?? 0) + 1);
      hotelCounts.set(b.hotelName, (hotelCounts.get(b.hotelName) ?? 0) + 1);
    }
    const popularDestinations = [...cityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([city, count]) => ({ city, count }));
    const popularHotels = [...hotelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hotelName, count]) => ({ hotelName, count }));

    return {
      bookings: bookings.length,
      completed: completed.length,
      cancelled,
      refunds,
      revenue,
      supplierCost,
      markup,
      margin: revenue - supplierCost,
      staffIncentives: staffIncentivesAgg._sum.amount ?? 0,
      popularDestinations,
      popularHotels,
    };
  }

  async profitReport(filters: HotelFilters) {
    const where = this.where(filters);
    const bookings = await this.prisma.hotelBooking.findMany({
      where,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        bookedByStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'HOTEL_BOOKING',
        sourceId: { in: bookings.map((b) => b.id) },
      },
    });
    const incentivesByBooking = new Map<string, number>();
    for (const inc of incentives) {
      incentivesByBooking.set(
        inc.sourceId,
        (incentivesByBooking.get(inc.sourceId) ?? 0) + inc.amount,
      );
    }

    return bookings.map((b) => {
      const staffIncentive = incentivesByBooking.get(b.id) ?? 0;
      const margin = b.totalAmount - (b.supplierCost ?? 0);
      return {
        bookingId: b.id,
        bookingReference: b.bookingReference,
        customer: `${b.customer.firstName} ${b.customer.lastName}`,
        hotel: b.hotelName,
        city: b.city,
        supplierCost: b.supplierCost ?? 0,
        sellingPrice: b.totalAmount,
        markup: b.markupAmount ?? 0,
        margin,
        staffIncentive,
        companyShare: margin - staffIncentive,
        status: b.status,
        staff: b.bookedByStaff
          ? `${b.bookedByStaff.firstName} ${b.bookedByStaff.lastName}`
          : null,
        branch: b.branch?.name ?? null,
        date: b.createdAt,
        currency: b.currency,
      };
    });
  }
}
