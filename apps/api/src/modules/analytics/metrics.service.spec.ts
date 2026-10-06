import type { AnalyticsScope } from './analytics-scope.service';
import { resolveRange } from './engine/periods';
import { MetricsService } from './metrics.service';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const RANGE = resolveRange('THIS_MONTH', NOW);

const tenantA: AnalyticsScope = {
  companyId: 'co-A',
  branchId: undefined,
  branchLocked: false,
  description: 'Whole company',
};
const branch: AnalyticsScope = {
  companyId: 'co-A',
  branchId: 'br-1',
  branchLocked: true,
  description: 'Your branch',
};
const platform: AnalyticsScope = {
  companyId: undefined,
  branchId: undefined,
  branchLocked: false,
  description: 'platform',
};

/** A Prisma double that records every `where` it is handed, so leakage can be asserted on ALL queries. */
function makePrisma(over: Record<string, unknown> = {}) {
  const wheres: string[] = [];
  // Loosely typed on purpose: these doubles stand in for many different Prisma
  // methods whose real signatures are not what is under test.

  type AnyMock = jest.Mock<Promise<any>, [any?]>;

  const rec = (value: unknown): AnyMock =>
    jest.fn((args?: { where?: unknown }) => {
      wheres.push(JSON.stringify(args?.where ?? {}));
      return Promise.resolve(value);
    });
  const flightAgg = {
    _sum: { totalAmount: 1000, providerCost: 600 },
    _min: { createdAt: null },
    _count: { _all: 2 },
  };
  const hotelAgg = {
    _sum: { totalAmount: 500, supplierCost: 300 },
    _min: { createdAt: null },
    _count: { _all: 1 },
  };
  const prisma = {
    company: { findUnique: jest.fn().mockResolvedValue({ currency: 'NGN' }) },
    customer: {
      aggregate: rec({ _min: { createdAt: new Date('2026-01-01T00:00:00Z') } }),
      count: rec(4),
    },
    flightBooking: {
      aggregate: rec(flightAgg),
      count: rec(0),
      groupBy: rec([
        {
          customerId: 'c1',
          _sum: { totalAmount: 1000 },
          _count: { _all: 2 },
          branchId: 'br-1',
        },
      ]),
    },
    hotelBooking: {
      aggregate: rec(hotelAgg),
      count: rec(0),
      groupBy: rec([
        {
          customerId: 'c2',
          _sum: { totalAmount: 500 },
          _count: { _all: 1 },
          branchId: 'br-1',
        },
      ]),
    },
    payment: {
      aggregate: rec({ _sum: { amount: 900 }, _count: { _all: 3 } }),
      groupBy: rec([]),
    },
    invoice: { findMany: rec([]) },
    supplierPayable: { findMany: rec([]) },
    supportTicket: { count: rec(0), findMany: rec([]) },
    branch: { findMany: rec([{ id: 'br-1', name: 'Kano' }]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  };
  return { prisma, wheres };
}

const svc = (p: unknown) => new MetricsService(p as never);

describe('MetricsService — tenant and branch isolation', () => {
  it('every query in a full tenant overview carries the tenant id', async () => {
    const { prisma, wheres } = makePrisma();
    await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: 'PREVIOUS_PERIOD',
      canViewFinance: true,
      now: NOW,
    });
    expect(wheres.length).toBeGreaterThan(20);
    for (const w of wheres) expect(w).toContain('"companyId":"co-A"');
  });

  it('a platform-wide (super admin) overview applies no tenant filter', async () => {
    const { prisma, wheres } = makePrisma();
    await svc(prisma).overview({
      scope: platform,
      range: RANGE,
      comparison: null,
      canViewFinance: true,
      now: NOW,
    });
    for (const w of wheres) expect(w).not.toContain('companyId');
  });

  it('a branch scope adds the branch to branch-attributable queries', async () => {
    const { prisma } = makePrisma();
    await svc(prisma).salesFigures(branch, RANGE, 'NGN');
    for (const call of prisma.flightBooking.aggregate.mock.calls)
      expect(call[0].where.branchId).toBe('br-1');
    for (const call of prisma.hotelBooking.aggregate.mock.calls)
      expect(call[0].where.branchId).toBe('br-1');
  });

  it('the scope object — not any request value — is the only source of tenant (no parameter can override it)', async () => {
    const { prisma, wheres } = makePrisma();
    await svc(prisma).overview({
      scope: { ...tenantA, companyId: 'co-B' },
      range: RANGE,
      comparison: null,
      canViewFinance: true,
      now: NOW,
    });
    for (const w of wheres) {
      expect(w).toContain('"companyId":"co-B"');
      expect(w).not.toContain('co-A');
    }
  });

  it('the raw-SQL trend binds the tenant id as a parameter and never inlines it', async () => {
    const { prisma } = makePrisma();
    await svc(prisma).trend({
      scope: tenantA,
      range: RANGE,
      metric: 'booked_value',
      granularity: 'day',
      base: 'NGN',
    });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      string[],
      ...unknown[],
    ];
    const bound = JSON.stringify(values);
    expect(bound).toContain('co-A'); // present only as a bound value
    expect(bound).toContain('companyId'); // inside the tenant predicate fragment
    expect(strings.join('')).not.toContain('co-A'); // never concatenated into the SQL text
  });

  it('the cash trend is tenant-bound too, and unavailable for a single branch', async () => {
    const { prisma } = makePrisma();
    await svc(prisma).trend({
      scope: tenantA,
      range: RANGE,
      metric: 'cash_collected',
      granularity: 'day',
      base: 'NGN',
    });
    expect(
      JSON.stringify((prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1)),
    ).toContain('co-A');
    prisma.$queryRaw.mockClear();
    expect(
      await svc(prisma).trend({
        scope: branch,
        range: RANGE,
        metric: 'cash_collected',
        granularity: 'day',
        base: 'NGN',
      }),
    ).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('MetricsService — honest figures', () => {
  it('computes booked value, count and average from the one definition', async () => {
    const { prisma } = makePrisma();
    const f = await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    expect(f.booked_value.value).toBe(1500);
    expect(f.bookings_count.value).toBe(3);
    expect(f.average_booking_value.value).toBe(500);
    expect(f.active_customers.value).toBe(2);
  });

  it('only counts active-sale statuses and the base currency', async () => {
    const { prisma } = makePrisma();
    await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    const first = prisma.flightBooking.aggregate.mock.calls[0][0].where;
    expect(first.status.in).not.toContain('PENDING');
    expect(first.status.in).not.toContain('CANCELLED');
    expect(first.currency).toBe('NGN');
  });

  it('margin covers only bookings with a recorded cost and reports the coverage — a missing cost is never zero', async () => {
    const { prisma } = makePrisma();
    // total bookings 3, but only 1 flight (of the 2) has a cost
    prisma.flightBooking.aggregate.mockImplementation(
      (args: { where: { providerCost?: unknown } }) =>
        Promise.resolve(
          args.where.providerCost
            ? {
                _sum: { totalAmount: 400, providerCost: 300 },
                _count: { _all: 1 },
              }
            : { _sum: { totalAmount: 1000 }, _count: { _all: 2 } },
        ),
    );
    prisma.hotelBooking.aggregate.mockImplementation(
      (args: { where: { supplierCost?: unknown } }) =>
        Promise.resolve(
          args.where.supplierCost
            ? { _sum: { totalAmount: 0, supplierCost: 0 }, _count: { _all: 0 } }
            : { _sum: { totalAmount: 500 }, _count: { _all: 1 } },
        ),
    );
    const f = await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    expect(f.gross_margin.value).toBe(100); // 400 - 300 only
    expect(f.gross_margin.details).toMatchObject({
      bookingsWithCost: 1,
      bookingsWithoutCost: 2,
      costCoveragePercent: 33.33,
    });
  });

  it('margin is UNAVAILABLE (null) rather than 100% when no booking has a cost', async () => {
    const { prisma } = makePrisma();
    prisma.flightBooking.aggregate.mockImplementation(
      (args: { where: { providerCost?: unknown } }) =>
        Promise.resolve(
          args.where.providerCost
            ? {
                _sum: { totalAmount: null, providerCost: null },
                _count: { _all: 0 },
              }
            : { _sum: { totalAmount: 1000 }, _count: { _all: 2 } },
        ),
    );
    prisma.hotelBooking.aggregate.mockResolvedValue({
      _sum: { totalAmount: null, supplierCost: null },
      _count: { _all: 0 },
    });
    const f = await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    expect(f.gross_margin.value).toBeNull();
    expect(f.gross_margin.reason).toContain('supplier cost');
  });

  it('with no bookings the average is null, not zero', async () => {
    const { prisma } = makePrisma();
    const empty = { _sum: { totalAmount: null }, _count: { _all: 0 } };
    prisma.flightBooking.aggregate.mockResolvedValue(empty);
    prisma.hotelBooking.aggregate.mockResolvedValue(empty);
    prisma.flightBooking.groupBy.mockResolvedValue([]);
    prisma.hotelBooking.groupBy.mockResolvedValue([]);
    const f = await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    expect(f.booked_value.value).toBe(0);
    expect(f.average_booking_value.value).toBeNull();
    expect(f.repeat_customer_rate.value).toBeNull();
  });

  it('repeat rate counts customers who also booked before the period', async () => {
    const { prisma } = makePrisma();
    prisma.flightBooking.groupBy.mockImplementation(
      (a: { where: { customerId?: unknown } }) =>
        Promise.resolve(
          a.where.customerId
            ? [{ customerId: 'c1' }]
            : [{ customerId: 'c1' }, { customerId: 'c2' }],
        ),
    );
    prisma.hotelBooking.groupBy.mockResolvedValue([]);
    const f = await svc(prisma).salesFigures(tenantA, RANGE, 'NGN');
    expect(f.repeat_customer_rate.value).toBe(50);
  });

  it('cash collected excludes void invoices and other currencies, and is unavailable for one branch', async () => {
    const { prisma } = makePrisma();
    const ok = await svc(prisma).cashCollected(tenantA, RANGE, 'NGN');
    expect(ok.value).toBe(900);
    const where = prisma.payment.aggregate.mock.calls[0][0].where;
    expect(where.invoice.status).toEqual({ not: 'VOID' });
    expect(where.invoice.currency).toBe('NGN');
    const blocked = await svc(prisma).cashCollected(branch, RANGE, 'NGN');
    expect(blocked.value).toBeNull();
    expect(blocked.reason).toContain('branch');
  });

  it('receivables are net of payments, never negative, and aged by days since issue', async () => {
    const day = 86_400_000;
    const { prisma } = makePrisma();
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 'i1',
        totalAmount: 1000,
        createdAt: new Date(NOW.getTime() - 10 * day),
      },
      {
        id: 'i2',
        totalAmount: 500,
        createdAt: new Date(NOW.getTime() - 45 * day),
      },
      {
        id: 'i3',
        totalAmount: 300,
        createdAt: new Date(NOW.getTime() - 100 * day),
      },
      {
        id: 'i4',
        totalAmount: 200,
        createdAt: new Date(NOW.getTime() - 5 * day),
      },
    ]);
    prisma.payment.groupBy.mockResolvedValue([
      { invoiceId: 'i1', _sum: { amount: 400 } },
      { invoiceId: 'i4', _sum: { amount: 250 } }, // overpaid -> counts as 0, never negative
    ]);
    const r = await svc(prisma).receivables(tenantA, 'NGN', NOW);
    expect(r.value).toBe(600 + 500 + 300);
    const by = Object.fromEntries(
      (r.ageing ?? []).map((a) => [a.key, a.amount]),
    );
    expect(by).toMatchObject({ D1_30: 600, D31_60: 500, D91_PLUS: 300 });
    expect(r.ageing?.find((a) => a.key === 'D31_60')?.label).toBe(
      '31–60 days since issue',
    );
    expect(r.details?.openInvoices).toBe(3);
  });

  it('payables with no due date go in their own bucket instead of being guessed', async () => {
    const day = 86_400_000;
    const { prisma } = makePrisma();
    prisma.supplierPayable.findMany.mockResolvedValue([
      {
        amount: 1000,
        amountPaid: 200,
        dueDate: new Date(NOW.getTime() - 40 * day),
      },
      { amount: 500, amountPaid: 0, dueDate: null },
      {
        amount: 700,
        amountPaid: 0,
        dueDate: new Date(NOW.getTime() + 10 * day),
      },
    ]);
    const r = await svc(prisma).supplierPayables(tenantA, 'NGN', NOW);
    expect(r.value).toBe(800 + 500 + 700);
    const by = Object.fromEntries(
      (r.ageing ?? []).map((a) => [a.key, a.amount]),
    );
    expect(by).toMatchObject({ D31_60: 800, NO_DUE_DATE: 500, CURRENT: 700 });
  });

  it('support averages only answered tickets and shows null when none were', async () => {
    const { prisma } = makePrisma();
    prisma.supportTicket.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);
    prisma.supportTicket.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-10-01T10:00:00Z'),
        firstRespondedAt: new Date('2026-10-01T10:30:00Z'),
      },
      {
        createdAt: new Date('2026-10-02T10:00:00Z'),
        firstRespondedAt: new Date('2026-10-02T11:30:00Z'),
      },
    ]);
    const s = await svc(prisma).supportFigures(tenantA, RANGE);
    expect(s.value).toBe(4);
    expect(s.details).toMatchObject({
      slaBreached: 1,
      slaBreachRatePercent: 25,
      avgFirstResponseMinutes: 60,
    });
    prisma.supportTicket.findMany.mockResolvedValue([]);
    prisma.supportTicket.count.mockResolvedValue(0);
    expect(
      (await svc(prisma).supportFigures(tenantA, RANGE)).details
        ?.avgFirstResponseMinutes,
    ).toBeNull();
  });
});

describe('MetricsService.overview — comparisons and permissions', () => {
  it('withholds every finance metric from a caller without the finance permission', async () => {
    const { prisma } = makePrisma();
    const out = await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: null,
      canViewFinance: false,
      now: NOW,
    });
    const keys = out.metrics.map((m) => m.key);
    for (const k of [
      'gross_margin',
      'cash_collected',
      'receivables_outstanding',
      'supplier_payables_outstanding',
    ])
      expect(keys).not.toContain(k);
    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
  });

  it('labels the data LIVE with a timestamp and the definitions version', async () => {
    const { prisma } = makePrisma();
    const out = await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: null,
      canViewFinance: true,
      now: NOW,
    });
    expect(out.meta).toMatchObject({
      freshness: 'LIVE',
      generatedAt: NOW.toISOString(),
      currency: 'NGN',
    });
    expect(out.meta.definitionsVersion).toBeTruthy();
  });

  it("a comparison that predates the tenant's first record is INSUFFICIENT_DATA, not a fake growth figure", async () => {
    const { prisma } = makePrisma();
    prisma.customer.aggregate.mockResolvedValue({
      _min: { createdAt: new Date('2026-10-01T00:00:00Z') },
    });
    const out = await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: 'PREVIOUS_MONTH',
      canViewFinance: false,
      now: NOW,
    });
    const booked = out.metrics.find((m) => m.key === 'booked_value');
    expect(booked?.comparison?.status).toBe('INSUFFICIENT_DATA');
    expect(booked?.comparison?.changePercent).toBeNull();
  });

  it('flags bookings in other currencies instead of silently summing or dropping them', async () => {
    const { prisma } = makePrisma();
    prisma.flightBooking.count.mockResolvedValue(2);
    const out = await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: null,
      canViewFinance: false,
      now: NOW,
    });
    expect(out.meta.warnings.join(' ')).toContain('other than NGN');
  });

  it('lists what cannot be computed rather than inventing it', async () => {
    const { prisma } = makePrisma();
    const out = await svc(prisma).overview({
      scope: tenantA,
      range: RANGE,
      comparison: null,
      canViewFinance: true,
      now: NOW,
    });
    expect(out.unavailable.map((u) => u.key)).toEqual(
      expect.arrayContaining([
        'forecast',
        'search_to_book_conversion',
        'budget_vs_actual',
      ]),
    );
  });

  it('unavailable metrics carry a reason and no comparison', async () => {
    const { prisma } = makePrisma();
    const out = await svc(prisma).overview({
      scope: branch,
      range: RANGE,
      comparison: 'PREVIOUS_PERIOD',
      canViewFinance: true,
      now: NOW,
    });
    const cash = out.metrics.find((m) => m.key === 'cash_collected');
    expect(cash).toMatchObject({
      status: 'UNAVAILABLE',
      value: null,
      comparison: null,
    });
    expect(cash?.unavailableReason).toContain('branch');
  });
});

describe('MetricsService.byBranch', () => {
  it('lists a branch with no sales in the period (zeros) so it can still be chosen', async () => {
    const { prisma } = makePrisma();
    prisma.branch.findMany.mockResolvedValue([
      { id: 'br-1', name: 'Kano' },
      { id: 'br-2', name: 'Abuja' },
    ]);
    const rows = await svc(prisma).byBranch(tenantA, RANGE, 'NGN');
    expect(rows.find((r) => r.branchId === 'br-2')).toEqual({
      branchId: 'br-2',
      name: 'Abuja',
      bookedValue: 0,
      bookings: 0,
    });
  });

  it('a branch-locked caller never sees another branch, even as a zero row', async () => {
    const { prisma } = makePrisma();
    prisma.branch.findMany.mockResolvedValue([
      { id: 'br-1', name: 'Kano' },
      { id: 'br-2', name: 'Abuja' },
    ]);
    const rows = await svc(prisma).byBranch(branch, RANGE, 'NGN'); // locked to br-1
    expect(rows.map((r) => r.branchId)).toEqual(['br-1']);
  });

  it("merges flights and hotels per branch and names them from the tenant's own branches", async () => {
    const { prisma } = makePrisma();
    const rows = await svc(prisma).byBranch(tenantA, RANGE, 'NGN');
    expect(rows).toEqual([
      { branchId: 'br-1', name: 'Kano', bookedValue: 1500, bookings: 3 },
    ]);
    expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'co-A',
    });
  });
});
