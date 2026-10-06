import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma, SupplierPayableStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AnalyticsScope } from './analytics-scope.service';
import {
  ACTIVE_FLIGHT_STATUSES,
  ACTIVE_HOTEL_STATUSES,
  CANCELLED_FLIGHT_STATUSES,
  CANCELLED_HOTEL_STATUSES,
  METRIC_DEFINITIONS,
  METRIC_DEFINITIONS_VERSION,
  MetricAccuracy,
  MetricDefinition,
  MetricDomain,
  MetricUnit,
  UNAVAILABLE_METRICS,
  UnavailableMetric,
} from './engine/metric-definitions';
import {
  AgeingBucketDef,
  bucketFor,
  buildAgeingBuckets,
  Comparison,
  compareValues,
  comparisonRangeToDate,
  ComparisonKind,
  daysOverdue,
  DateRange,
  LAGOS_OFFSET_MINUTES,
} from './engine/periods';

export interface MetricResult {
  key: string;
  name: string;
  domain: MetricDomain;
  unit: MetricUnit;
  accuracy: MetricAccuracy;
  status: 'OK' | 'UNAVAILABLE';
  value: number | null;
  comparison: Comparison | null;
  unavailableReason?: string;
  details?: Record<string, unknown>;
}

export interface AgeingRow {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface OverviewResponse {
  meta: {
    generatedAt: string;
    freshness: 'LIVE';
    freshnessNote: string;
    definitionsVersion: string;
    currency: string;
    scope: {
      description: string;
      branchId: string | null;
      branchLocked: boolean;
      platformWide: boolean;
    };
    range: {
      preset: string;
      label: string;
      start: string;
      end: string;
      inProgress: boolean;
    };
    comparison: { label: string; start: string; end: string } | null;
    historyStartsAt: string | null;
    warnings: string[];
  };
  metrics: MetricResult[];
  unavailable: UnavailableMetric[];
}

type Figure = {
  value: number | null;
  reason?: string;
  details?: Record<string, unknown>;
};

const MAX_ROWS = 20_000;
/** Above this many distinct customers the repeat-rate lookup is skipped rather than risking a slow query. */
const MAX_REPEAT_IDS = 10_000;

const half = (n: number, d: number): number => Math.round((n / d) * 100) / 100;

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- scoping

  /** `customer.companyId` is how a booking/ticket/invoice is tied to a tenant (they have no companyId column). */
  private customerRel(scope: AnalyticsScope): {
    customer?: { companyId: string };
  } {
    return scope.companyId ? { customer: { companyId: scope.companyId } } : {};
  }

  private branchRel(scope: AnalyticsScope): { branchId?: string } {
    return scope.branchId ? { branchId: scope.branchId } : {};
  }

  async baseCurrency(scope: AnalyticsScope): Promise<string> {
    if (!scope.companyId) return 'NGN';
    const company = await this.prisma.company.findUnique({
      where: { id: scope.companyId },
      select: { currency: true },
    });
    return company?.currency ?? 'NGN';
  }

  /** When this tenant's own data begins — a comparison window before it is not a real baseline. */
  async historyStart(scope: AnalyticsScope): Promise<Date | null> {
    // Bookings can be back-dated (imports, offline entries), so customers alone under-state the history.
    const [customers, flights, hotels] = await Promise.all([
      this.prisma.customer.aggregate({
        where: scope.companyId ? { companyId: scope.companyId } : {},
        _min: { createdAt: true },
      }),
      this.prisma.flightBooking.aggregate({
        where: this.customerRel(scope),
        _min: { createdAt: true },
      }),
      this.prisma.hotelBooking.aggregate({
        where: this.customerRel(scope),
        _min: { createdAt: true },
      }),
    ]);
    const dates = [
      customers._min.createdAt,
      flights._min.createdAt,
      hotels._min.createdAt,
    ].filter((d): d is Date => d instanceof Date);
    return dates.length === 0
      ? null
      : new Date(Math.min(...dates.map((d) => d.getTime())));
  }

  // ----------------------------------------------------------- period figures

  private flightWhere(
    scope: AnalyticsScope,
    range: DateRange,
    statuses: typeof ACTIVE_FLIGHT_STATUSES,
    dateField: 'createdAt' | 'updatedAt' = 'createdAt',
  ): Prisma.FlightBookingWhereInput {
    return {
      status: { in: statuses },
      [dateField]: { gte: range.start, lt: range.end },
      ...this.customerRel(scope),
      ...this.branchRel(scope),
    };
  }

  private hotelWhere(
    scope: AnalyticsScope,
    range: DateRange,
    statuses: typeof ACTIVE_HOTEL_STATUSES,
    dateField: 'createdAt' | 'updatedAt' = 'createdAt',
  ): Prisma.HotelBookingWhereInput {
    return {
      status: { in: statuses },
      [dateField]: { gte: range.start, lt: range.end },
      ...this.customerRel(scope),
      ...this.branchRel(scope),
    };
  }

  /** Every figure that comes from a period of booking activity, computed in one pass per window. */
  async salesFigures(
    scope: AnalyticsScope,
    range: DateRange,
    base: string,
  ): Promise<Record<string, Figure> & { _otherCurrency: Figure }> {
    const fw = {
      ...this.flightWhere(scope, range, ACTIVE_FLIGHT_STATUSES),
      currency: base,
    };
    const hw = {
      ...this.hotelWhere(scope, range, ACTIVE_HOTEL_STATUSES),
      currency: base,
    };

    const [
      fSum,
      hSum,
      fOther,
      hOther,
      fCost,
      hCost,
      fCancel,
      hCancel,
      fCustomers,
      hCustomers,
    ] = await Promise.all([
      this.prisma.flightBooking.aggregate({
        where: fw,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.hotelBooking.aggregate({
        where: hw,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.flightBooking.count({
        where: {
          ...this.flightWhere(scope, range, ACTIVE_FLIGHT_STATUSES),
          NOT: { currency: base },
        },
      }),
      this.prisma.hotelBooking.count({
        where: {
          ...this.hotelWhere(scope, range, ACTIVE_HOTEL_STATUSES),
          NOT: { currency: base },
        },
      }),
      this.prisma.flightBooking.aggregate({
        where: { ...fw, providerCost: { not: null } },
        _sum: { totalAmount: true, providerCost: true },
        _count: { _all: true },
      }),
      this.prisma.hotelBooking.aggregate({
        where: { ...hw, supplierCost: { not: null } },
        _sum: { totalAmount: true, supplierCost: true },
        _count: { _all: true },
      }),
      this.prisma.flightBooking.count({
        where: this.flightWhere(
          scope,
          range,
          CANCELLED_FLIGHT_STATUSES,
          'updatedAt',
        ),
      }),
      this.prisma.hotelBooking.count({
        where: this.hotelWhere(
          scope,
          range,
          CANCELLED_HOTEL_STATUSES,
          'updatedAt',
        ),
      }),
      this.prisma.flightBooking.groupBy({ by: ['customerId'], where: fw }),
      this.prisma.hotelBooking.groupBy({ by: ['customerId'], where: hw }),
    ]);

    const flightsValue = fSum._sum.totalAmount ?? 0;
    const hotelsValue = hSum._sum.totalAmount ?? 0;
    const flightsCount = fSum._count._all;
    const hotelsCount = hSum._count._all;
    const bookedValue = flightsValue + hotelsValue;
    const bookings = flightsCount + hotelsCount;

    const withCost = fCost._count._all + hCost._count._all;
    const costedRevenue =
      (fCost._sum.totalAmount ?? 0) + (hCost._sum.totalAmount ?? 0);
    const costTotal =
      (fCost._sum.providerCost ?? 0) + (hCost._sum.supplierCost ?? 0);

    const customerIds = new Set<string>([
      ...fCustomers.map((c) => c.customerId),
      ...hCustomers.map((c) => c.customerId),
    ]);

    const out: Record<string, Figure> = {
      booked_value: {
        value: bookedValue,
        details: { flights: flightsValue, hotels: hotelsValue },
      },
      bookings_count: {
        value: bookings,
        details: { flights: flightsCount, hotels: hotelsCount },
      },
      average_booking_value:
        bookings > 0
          ? { value: Math.round(bookedValue / bookings) }
          : { value: null, reason: 'No bookings in this period' },
      cancellations: {
        value: fCancel + hCancel,
        details: { flights: fCancel, hotels: hCancel },
      },
      active_customers: { value: customerIds.size },
      gross_margin:
        withCost === 0
          ? {
              value: null,
              reason:
                bookings === 0
                  ? 'No bookings in this period'
                  : 'No booking in this period has a recorded supplier cost',
            }
          : {
              value: costedRevenue - costTotal,
              details: {
                costCoveragePercent:
                  bookings > 0 ? half(withCost * 100, bookings) : null,
                bookingsWithCost: withCost,
                bookingsWithoutCost: bookings - withCost,
                marginPercentOfCostedValue:
                  costedRevenue > 0
                    ? half((costedRevenue - costTotal) * 100, costedRevenue)
                    : null,
                costedBookedValue: costedRevenue,
              },
            },
    };

    out.repeat_customer_rate = await this.repeatRate(
      scope,
      range,
      base,
      customerIds,
    );
    return Object.assign(out, {
      _otherCurrency: { value: fOther + hOther },
    });
  }

  private async repeatRate(
    scope: AnalyticsScope,
    range: DateRange,
    base: string,
    ids: Set<string>,
  ): Promise<Figure> {
    if (ids.size === 0)
      return { value: null, reason: 'No active customers in this period' };
    if (ids.size > MAX_REPEAT_IDS)
      return {
        value: null,
        reason:
          'Too many customers to compute the repeat rate cheaply for this period',
      };
    const list = [...ids];
    const before = { lt: range.start };
    const [f, h] = await Promise.all([
      this.prisma.flightBooking.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: list },
          status: { in: ACTIVE_FLIGHT_STATUSES },
          currency: base,
          createdAt: before,
          ...this.customerRel(scope),
          ...this.branchRel(scope),
        },
      }),
      this.prisma.hotelBooking.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: list },
          status: { in: ACTIVE_HOTEL_STATUSES },
          currency: base,
          createdAt: before,
          ...this.customerRel(scope),
          ...this.branchRel(scope),
        },
      }),
    ]);
    const repeat = new Set([
      ...f.map((x) => x.customerId),
      ...h.map((x) => x.customerId),
    ]);
    return {
      value: half(repeat.size * 100, ids.size),
      details: { repeatCustomers: repeat.size, activeCustomers: ids.size },
    };
  }

  async cashCollected(
    scope: AnalyticsScope,
    range: DateRange,
    base: string,
  ): Promise<Figure> {
    if (scope.branchId)
      return {
        value: null,
        reason:
          'Payments carry no branch, so cash collected cannot be shown for a single branch',
      };
    const agg = await this.prisma.payment.aggregate({
      where: {
        paidAt: { gte: range.start, lt: range.end },
        invoice: {
          status: { not: InvoiceStatus.VOID },
          currency: base,
          ...this.customerRel(scope),
        },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return {
      value: agg._sum.amount ?? 0,
      details: { payments: agg._count._all },
    };
  }

  async newCustomers(scope: AnalyticsScope, range: DateRange): Promise<Figure> {
    const value = await this.prisma.customer.count({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchId ? { assignedBranchId: scope.branchId } : {}),
      },
    });
    return { value };
  }

  async supportFigures(
    scope: AnalyticsScope,
    range: DateRange,
  ): Promise<Figure> {
    const where: Prisma.SupportTicketWhereInput = {
      createdAt: { gte: range.start, lt: range.end },
      ...this.customerRel(scope),
      ...this.branchRel(scope),
    };
    const [opened, breached, answered] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.count({
        where: { ...where, slaBreached: true },
      }),
      this.prisma.supportTicket.findMany({
        where: { ...where, firstRespondedAt: { not: null } },
        select: { createdAt: true, firstRespondedAt: true },
        take: MAX_ROWS,
      }),
    ]);
    const minutes = answered.map(
      (t) =>
        ((t.firstRespondedAt as Date).getTime() - t.createdAt.getTime()) /
        60_000,
    );
    const avgFirstResponseMinutes =
      minutes.length > 0
        ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)
        : null;
    return {
      value: opened,
      details: {
        slaBreached: breached,
        slaBreachRatePercent: opened > 0 ? half(breached * 100, opened) : null,
        answered: answered.length,
        avgFirstResponseMinutes,
        avgFirstResponseBasis:
          answered.length >= MAX_ROWS
            ? `first ${MAX_ROWS} answered tickets`
            : 'all answered tickets',
      },
    };
  }

  // ----------------------------------------------------- point-in-time figures

  /** Receivables as of now, aged by days since the invoice was issued (invoices have no due date). */
  async receivables(
    scope: AnalyticsScope,
    base: string,
    now: Date,
  ): Promise<Figure & { ageing?: AgeingRow[] }> {
    if (scope.branchId)
      return {
        value: null,
        reason:
          'Invoices carry no branch, so receivables cannot be shown for a single branch',
      };
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      currency: base,
      ...this.customerRel(scope),
    };
    const [invoices, paid] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        select: { id: true, totalAmount: true, createdAt: true },
        take: MAX_ROWS + 1,
      }),
      this.prisma.payment.groupBy({
        by: ['invoiceId'],
        where: { invoice: invoiceWhere },
        _sum: { amount: true },
      }),
    ]);
    const truncated = invoices.length > MAX_ROWS;
    const paidBy = new Map(paid.map((p) => [p.invoiceId, p._sum.amount ?? 0]));
    const buckets = buildAgeingBuckets();
    const rows = new Map<string, AgeingRow>(
      buckets.map((b) => [
        b.key,
        { key: b.key, label: this.sinceIssueLabel(b), amount: 0, count: 0 },
      ]),
    );
    let total = 0;
    let count = 0;
    for (const inv of invoices.slice(0, MAX_ROWS)) {
      const outstanding = Math.max(
        0,
        inv.totalAmount - (paidBy.get(inv.id) ?? 0),
      );
      if (outstanding === 0) continue;
      const row = rows.get(
        bucketFor(daysOverdue(inv.createdAt, now), buckets).key,
      ) as AgeingRow;
      row.amount += outstanding;
      row.count += 1;
      total += outstanding;
      count += 1;
    }
    return {
      value: total,
      ageing: [...rows.values()],
      details: {
        openInvoices: count,
        ageingBasis:
          'days since the invoice was issued (invoices have no due date)',
        truncated,
      },
    };
  }

  private sinceIssueLabel(b: AgeingBucketDef): string {
    if (b.key === 'CURRENT') return 'Issued today';
    return `${b.label} since issue`;
  }

  async supplierPayables(
    scope: AnalyticsScope,
    base: string,
    now: Date,
  ): Promise<Figure & { ageing?: AgeingRow[] }> {
    if (scope.branchId)
      return {
        value: null,
        reason:
          'Supplier payables carry no branch, so they cannot be shown for a single branch',
      };
    const payables = await this.prisma.supplierPayable.findMany({
      where: {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        currency: base,
        status: { not: SupplierPayableStatus.PAID },
      },
      select: { amount: true, amountPaid: true, dueDate: true },
      take: MAX_ROWS + 1,
    });
    const truncated = payables.length > MAX_ROWS;
    const buckets = buildAgeingBuckets();
    const rows = new Map<string, AgeingRow>([
      [
        'NO_DUE_DATE',
        { key: 'NO_DUE_DATE', label: 'No due date', amount: 0, count: 0 },
      ],
      ...buckets.map((b): [string, AgeingRow] => [
        b.key,
        {
          key: b.key,
          label: b.key === 'CURRENT' ? 'Not yet due' : `${b.label} overdue`,
          amount: 0,
          count: 0,
        },
      ]),
    ]);
    let total = 0;
    let count = 0;
    for (const p of payables.slice(0, MAX_ROWS)) {
      const outstanding = Math.max(0, p.amount - p.amountPaid);
      if (outstanding === 0) continue;
      const key = p.dueDate
        ? bucketFor(daysOverdue(p.dueDate, now), buckets).key
        : 'NO_DUE_DATE';
      const row = rows.get(key) as AgeingRow;
      row.amount += outstanding;
      row.count += 1;
      total += outstanding;
      count += 1;
    }
    return {
      value: total,
      ageing: [...rows.values()],
      details: { openPayables: count, truncated },
    };
  }

  // ------------------------------------------------------------------ overview

  async overview(params: {
    scope: AnalyticsScope;
    range: DateRange;
    comparison: ComparisonKind | null;
    canViewFinance: boolean;
    now: Date;
  }): Promise<OverviewResponse> {
    const { scope, range, canViewFinance, now } = params;
    const base = await this.baseCurrency(scope);
    // An unfinished period is compared with the same elapsed time, never the whole previous one.
    const compared = params.comparison
      ? comparisonRangeToDate(range, params.comparison, now)
      : null;
    const compRange = compared?.range ?? null;
    const inProgress = now.getTime() < range.end.getTime();
    const historyStartsAt = await this.historyStart(scope);

    const windowFigures = async (
      r: DateRange,
    ): Promise<Map<string, Figure>> => {
      const sales = await this.salesFigures(scope, r, base);
      const map = new Map<string, Figure>(
        Object.entries(sales).filter(([k]) => !k.startsWith('_')),
      );
      map.set('new_customers', await this.newCustomers(scope, r));
      map.set('support_tickets', await this.supportFigures(scope, r));
      if (canViewFinance)
        map.set('cash_collected', await this.cashCollected(scope, r, base));
      map.set('_otherCurrency', sales._otherCurrency);
      return map;
    };

    const current = await windowFigures(range);
    const previous = compRange ? await windowFigures(compRange) : null;
    // A comparison window that ends before the tenant's first record is not a baseline at all.
    const baselineHasData =
      !compRange || !historyStartsAt || compRange.end > historyStartsAt;

    const warnings: string[] = [];
    if (params.comparison && !compRange) {
      warnings.push(
        'This period has not started yet, so there is nothing to compare.',
      );
    } else if (compRange && inProgress) {
      warnings.push(
        'This period is still in progress: it is compared with the same elapsed time in the earlier period, not the whole of it.',
      );
    }
    const otherCurrency = current.get('_otherCurrency')?.value ?? 0;
    if (otherCurrency > 0) {
      warnings.push(
        `${otherCurrency} active booking(s) in a currency other than ${base} were left out of money totals (no exchange-rate history exists to convert them).`,
      );
    }

    const metrics: MetricResult[] = [];
    for (const def of METRIC_DEFINITIONS) {
      if (def.audience === 'FINANCE' && !canViewFinance) continue;
      if (def.pointInTime) continue; // handled below
      const fig = current.get(def.key) ?? {
        value: null,
        reason: 'Not computed',
      };
      metrics.push(
        this.toResult(
          def,
          fig,
          previous?.get(def.key) ?? null,
          !!compRange,
          baselineHasData,
        ),
      );
    }

    if (canViewFinance) {
      const [rec, pay] = await Promise.all([
        this.receivables(scope, base, now),
        this.supplierPayables(scope, base, now),
      ]);
      for (const [def, fig] of [
        [
          METRIC_DEFINITIONS.find(
            (m) => m.key === 'receivables_outstanding',
          ) as MetricDefinition,
          rec,
        ],
        [
          METRIC_DEFINITIONS.find(
            (m) => m.key === 'supplier_payables_outstanding',
          ) as MetricDefinition,
          pay,
        ],
      ] as const) {
        const result = this.toResult(def, fig, null, false, true);
        if (fig.ageing)
          result.details = { ...(result.details ?? {}), ageing: fig.ageing };
        metrics.push(result);
      }
    }

    return {
      meta: {
        generatedAt: now.toISOString(),
        freshness: 'LIVE',
        freshnessNote:
          'Computed directly from transactional records at the time of the request; nothing is cached or pre-aggregated, so no figure is older than generatedAt.',
        definitionsVersion: METRIC_DEFINITIONS_VERSION,
        currency: base,
        scope: {
          description: scope.description,
          branchId: scope.branchId ?? null,
          branchLocked: scope.branchLocked,
          platformWide: scope.companyId === undefined,
        },
        range: {
          preset: range.preset,
          label: range.label,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          inProgress,
        },
        comparison: compRange
          ? {
              label: compRange.label,
              start: compRange.start.toISOString(),
              end: compRange.end.toISOString(),
            }
          : null,
        historyStartsAt: historyStartsAt ? historyStartsAt.toISOString() : null,
        warnings,
      },
      metrics,
      unavailable: [...UNAVAILABLE_METRICS],
    };
  }

  private toResult(
    def: MetricDefinition,
    fig: Figure,
    prev: Figure | null,
    compared: boolean,
    baselineHasData: boolean,
  ): MetricResult {
    const base: MetricResult = {
      key: def.key,
      name: def.name,
      domain: def.domain,
      unit: def.unit,
      accuracy: def.accuracy,
      status: fig.value === null ? 'UNAVAILABLE' : 'OK',
      value: fig.value,
      comparison: null,
      details: fig.details,
    };
    if (fig.value === null) {
      base.unavailableReason = fig.reason ?? 'Not available';
      return base;
    }
    if (compared) {
      base.comparison = compareValues(
        fig.value,
        prev?.value ?? null,
        baselineHasData,
      );
    }
    return base;
  }

  // -------------------------------------------------------------------- branches

  /** Booked value and bookings per branch, for a company-wide view. A branch-locked caller sees only their own row. */
  async byBranch(
    scope: AnalyticsScope,
    range: DateRange,
    base: string,
  ): Promise<
    {
      branchId: string | null;
      name: string;
      bookedValue: number;
      bookings: number;
    }[]
  > {
    const fw = {
      ...this.flightWhere(scope, range, ACTIVE_FLIGHT_STATUSES),
      currency: base,
    };
    const hw = {
      ...this.hotelWhere(scope, range, ACTIVE_HOTEL_STATUSES),
      currency: base,
    };
    const [f, h, branches] = await Promise.all([
      this.prisma.flightBooking.groupBy({
        by: ['branchId'],
        where: fw,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.hotelBooking.groupBy({
        by: ['branchId'],
        where: hw,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.branch.findMany({
        where: scope.companyId ? { companyId: scope.companyId } : {},
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(branches.map((b) => [b.id, b.name]));
    const acc = new Map<
      string | null,
      { bookedValue: number; bookings: number }
    >();
    for (const row of [...f, ...h]) {
      const cur = acc.get(row.branchId) ?? { bookedValue: 0, bookings: 0 };
      cur.bookedValue += row._sum.totalAmount ?? 0;
      cur.bookings += row._count._all;
      acc.set(row.branchId, cur);
    }
    // A branch with no sales in the period is still a branch: list it with zeros, so it can be
    // chosen and compared. A branch-restricted caller only ever gets their own.
    for (const b of branches) {
      if (scope.branchId && b.id !== scope.branchId) continue;
      if (!acc.has(b.id)) acc.set(b.id, { bookedValue: 0, bookings: 0 });
    }
    return [...acc.entries()]
      .map(([branchId, v]) => ({
        branchId,
        name: branchId
          ? (names.get(branchId) ?? 'Unknown branch')
          : 'No branch recorded',
        ...v,
      }))
      .sort((a, b) => b.bookedValue - a.bookedValue);
  }

  // ----------------------------------------------------------------------- trend

  /**
   * Time series for one metric, bucketed in local time. Grouping happens in the
   * database (one query), so a long range never loads rows into memory. Every
   * query is parameterised and carries the tenant/branch predicate explicitly.
   */
  async trend(params: {
    scope: AnalyticsScope;
    range: DateRange;
    metric: 'booked_value' | 'bookings_count' | 'cash_collected';
    granularity: 'day' | 'week' | 'month';
    base: string;
  }): Promise<{ key: string; value: number }[] | null> {
    const { scope, range, metric, granularity, base } = params;
    const off = LAGOS_OFFSET_MINUTES;
    const trunc = Prisma.raw(`'${granularity}'`); // granularity is validated against a fixed union by the controller
    const fmt = Prisma.raw(
      granularity === 'month' ? `'YYYY-MM-01'` : `'YYYY-MM-DD'`,
    );
    const local = (col: string) =>
      Prisma.sql`date_trunc(${trunc}, ${Prisma.raw(col)} + (${off}::int * interval '1 minute'))`;
    const tenantClause = scope.companyId
      ? Prisma.sql`AND c."companyId" = ${scope.companyId}`
      : Prisma.empty;
    const branchClause = scope.branchId
      ? Prisma.sql`AND b."branchId" = ${scope.branchId}`
      : Prisma.empty;
    const flightStatuses = ACTIVE_FLIGHT_STATUSES.map((s) => s as string);
    const hotelStatuses = ACTIVE_HOTEL_STATUSES.map((s) => s as string);

    let rows: { bucket: string; value: bigint | number | null }[];
    if (metric === 'cash_collected') {
      if (scope.branchId) return null;
      const tenantPay = scope.companyId
        ? Prisma.sql`AND c."companyId" = ${scope.companyId}`
        : Prisma.empty;
      rows = await this.prisma.$queryRaw`
        SELECT to_char(${local('p."paidAt"')}, ${fmt}) AS bucket, SUM(p."amount") AS value
        FROM "payments" p
        JOIN "invoices" i ON i."id" = p."invoiceId"
        JOIN "customers" c ON c."id" = i."customerId"
        WHERE p."paidAt" >= ${range.start} AND p."paidAt" < ${range.end}
          AND i."status" <> 'VOID' AND i."currency" = ${base} ${tenantPay}
        GROUP BY 1 ORDER BY 1`;
    } else {
      const select =
        metric === 'booked_value' ? Prisma.sql`b."totalAmount"` : Prisma.sql`1`;
      rows = await this.prisma.$queryRaw`
        SELECT to_char(${local('x."createdAt"')}, ${fmt}) AS bucket, SUM(x."v") AS value FROM (
          SELECT b."createdAt", ${select} AS v FROM "flight_bookings" b
            JOIN "customers" c ON c."id" = b."customerId"
            WHERE b."status"::text = ANY(${flightStatuses}) AND b."currency" = ${base}
              AND b."createdAt" >= ${range.start} AND b."createdAt" < ${range.end} ${tenantClause} ${branchClause}
          UNION ALL
          SELECT b."createdAt", ${select} AS v FROM "hotel_bookings" b
            JOIN "customers" c ON c."id" = b."customerId"
            WHERE b."status"::text = ANY(${hotelStatuses}) AND b."currency" = ${base}
              AND b."createdAt" >= ${range.start} AND b."createdAt" < ${range.end} ${tenantClause} ${branchClause}
        ) x GROUP BY 1 ORDER BY 1`;
    }
    return rows.map((r) => ({ key: r.bucket, value: Number(r.value ?? 0) }));
  }
}
