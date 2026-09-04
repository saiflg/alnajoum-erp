import { Injectable } from '@nestjs/common';
import { FlightBookingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

export interface FlightKpis {
  searches: number;
  bookings: number;
  ticketed: number;
  cancelled: number;
  refunds: number;
  reissues: number;
  revenue: number;
  providerCost: number;
  markup: number;
  margin: number;
  staffIncentives: number;
  providerSuccessRate: Array<{
    provider: string;
    total: number;
    successful: number;
    successRate: number;
  }>;
}

export interface FlightFilters {
  from?: Date;
  to?: Date;
  branchId?: string;
  staffId?: string;
  airlineCode?: string;
  provider?: string;
}

/**
 * Flight Admin Dashboard (spec #25) — daily/weekly/monthly/annual filtering
 * is left to the caller (pass `from`/`to`); branch/staff/airline/provider/
 * route breakdowns are each their own filter rather than baked-in
 * groupings, since the same query shape answers all of them.
 */
@Injectable()
export class FlightReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerLog: ProviderTransactionLogService,
  ) {}

  private dateRange(filters: FlightFilters) {
    return {
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.staffId ? { bookedByStaffId: filters.staffId } : {}),
    };
  }

  async kpis(filters: FlightFilters): Promise<FlightKpis> {
    const where = this.dateRange(filters);
    const bookings = await this.prisma.flightBooking.findMany({ where });

    const searches = await this.providerLog
      .listAll({})
      .then((rows) => rows.filter((r) => r.operation === 'SEARCH').length);

    const ticketed = bookings.filter(
      (b) => b.status === FlightBookingStatus.TICKETED,
    ).length;
    const cancelled = bookings.filter(
      (b) => b.status === FlightBookingStatus.CANCELLED,
    ).length;
    const revenue = bookings
      .filter((b) => b.status === FlightBookingStatus.TICKETED)
      .reduce((sum, b) => sum + b.totalAmount, 0);
    const providerCost = bookings
      .filter((b) => b.status === FlightBookingStatus.TICKETED)
      .reduce((sum, b) => sum + (b.providerCost ?? 0), 0);
    const markup = bookings
      .filter((b) => b.status === FlightBookingStatus.TICKETED)
      .reduce((sum, b) => sum + (b.markupAmount ?? 0), 0);

    const bookingIds = bookings.map((b) => b.id);
    const refunds = await this.prisma.flightRefund.count({
      where: { bookingId: { in: bookingIds } },
    });
    const reissues = await this.prisma.flightReissue.count({
      where: { bookingId: { in: bookingIds } },
    });
    const staffIncentivesAgg = await this.prisma.staffIncentive.aggregate({
      where: { sourceType: 'FLIGHT_BOOKING', sourceId: { in: bookingIds } },
      _sum: { amount: true },
    });

    const providerSuccessRate = await this.providerLog.successRateByProvider();

    return {
      searches,
      bookings: bookings.length,
      ticketed,
      cancelled,
      refunds,
      reissues,
      revenue,
      providerCost,
      markup,
      margin: revenue - providerCost,
      staffIncentives: staffIncentivesAgg._sum.amount ?? 0,
      providerSuccessRate,
    };
  }

  async profitReport(filters: FlightFilters) {
    const where = this.dateRange(filters);
    const bookings = await this.prisma.flightBooking.findMany({
      where,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        bookedByStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const incentivesByBooking = new Map<string, number>();
    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'FLIGHT_BOOKING',
        sourceId: { in: bookings.map((b) => b.id) },
      },
    });
    for (const inc of incentives) {
      incentivesByBooking.set(
        inc.sourceId,
        (incentivesByBooking.get(inc.sourceId) ?? 0) + inc.amount,
      );
    }

    return bookings.map((b) => {
      const staffIncentive = incentivesByBooking.get(b.id) ?? 0;
      const margin = b.totalAmount - (b.providerCost ?? 0);
      return {
        bookingId: b.id,
        bookingReference: b.bookingReference,
        customer: `${b.customer.firstName} ${b.customer.lastName}`,
        route: `${b.origin} → ${b.destination}`,
        provider: b.provider,
        providerCost: b.providerCost ?? 0,
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
