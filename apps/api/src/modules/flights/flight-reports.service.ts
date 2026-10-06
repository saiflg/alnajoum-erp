import { Injectable } from '@nestjs/common';
import { FlightBookingStatus, FlightProviderName } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScopeService,
  customerTenant,
  ReportScope,
  staffTenant,
} from '../analytics/analytics-scope.service';
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
  /** Caller-supplied; validated against the caller's own tenant/branch before use. */
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
    private readonly scopes: AnalyticsScopeService,
  ) {}

  /**
   * The tenant comes from the caller's token, never from the request. A branch
   * the caller asks for must belong to their company (404 otherwise) and a
   * branch-locked caller (branch manager) is held to their own branch; a staff
   * filter must be someone in that same scope.
   */
  private async scopeFor(
    user: AuthContext,
    filters: FlightFilters,
  ): Promise<ReportScope> {
    const scope = await this.scopes.resolve(user, filters.branchId);
    if (filters.staffId) {
      await this.scopes.assertStaffInScope(scope, filters.staffId);
    }
    return scope;
  }

  private dateRange(filters: FlightFilters, scope: ReportScope) {
    return {
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(filters.staffId ? { bookedByStaffId: filters.staffId } : {}),
      ...customerTenant(scope),
    };
  }

  async kpis(user: AuthContext, filters: FlightFilters): Promise<FlightKpis> {
    const scope = await this.scopeFor(user, filters);
    const where = this.dateRange(filters, scope);
    const bookings = await this.prisma.flightBooking.findMany({ where });

    // Provider searches carry no booking, hence no tenant: only SUPER_ADMIN's
    // platform-wide view can count them (a tenant caller gets 0).
    const searches = await this.providerLog
      .listAll({}, scope)
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
    const bookingRel = { booking: { ...customerTenant(scope) } };
    const refunds = await this.prisma.flightRefund.count({
      where: { bookingId: { in: bookingIds }, ...bookingRel },
    });
    const reissues = await this.prisma.flightReissue.count({
      where: { bookingId: { in: bookingIds }, ...bookingRel },
    });
    const staffIncentivesAgg = await this.prisma.staffIncentive.aggregate({
      where: {
        sourceType: 'FLIGHT_BOOKING',
        sourceId: { in: bookingIds },
        ...staffTenant(scope),
      },
      _sum: { amount: true },
    });

    const providerSuccessRate =
      await this.providerLog.successRateByProvider(scope);

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

  async providerLogs(user: AuthContext, provider?: FlightProviderName) {
    return this.providerLog.listAll(
      { provider },
      this.scopes.tenantScope(user),
    );
  }

  async profitReport(user: AuthContext, filters: FlightFilters) {
    const scope = await this.scopeFor(user, filters);
    const where = this.dateRange(filters, scope);
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
        ...staffTenant(scope),
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
