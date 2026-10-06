import type { AnalyticsScope } from './analytics-scope.service';
import { DataQualityService } from './data-quality.service';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const tenant: AnalyticsScope = {
  companyId: 'co-A',
  branchId: undefined,
  branchLocked: false,
  description: 'Whole company',
};
const platform: AnalyticsScope = {
  companyId: undefined,
  branchId: undefined,
  branchLocked: false,
  description: 'platform',
};

function makePrisma(counts: Partial<Record<string, number>> = {}) {
  const wheres: string[] = [];
  const c = (key: string, dflt = 0) =>
    jest.fn((a?: { where?: unknown }) => {
      wheres.push(JSON.stringify(a?.where ?? {}));
      return Promise.resolve(counts[key] ?? dflt);
    });
  return {
    wheres,
    prisma: {
      flightBooking: {
        findMany: jest.fn().mockResolvedValue([{ id: 'f1' }]),
        count: c('flight'),
      },
      hotelBooking: {
        findMany: jest.fn().mockResolvedValue([]),
        count: c('hotel'),
      },
      payment: { count: c('voidPay') },
      supplierPayable: { count: c('payable') },
      invoice: { count: c('orphan') },
      journalEntry: { count: c('reversed') },
    },
  };
}

describe('DataQualityService', () => {
  it('is read-only: it only ever counts and reads', async () => {
    const { prisma } = makePrisma();
    await new DataQualityService(prisma as never).run(tenant, 'NGN', NOW);
    const verbs = Object.values(prisma).flatMap((m) => Object.keys(m));
    for (const v of verbs) expect(['findMany', 'count']).toContain(v);
  });

  it('reports CLEAN when nothing is wrong', async () => {
    const { prisma } = makePrisma();
    prisma.flightBooking.findMany.mockResolvedValue([]);
    const r = await new DataQualityService(prisma as never).run(
      tenant,
      'NGN',
      NOW,
    );
    expect(r.status).toBe('CLEAN');
    expect(r.summary).toEqual({ errors: 0, warnings: 0, info: 0 });
  });

  it('flags missing costs with record ids only, and says which metric they distort', async () => {
    const { prisma } = makePrisma({ flight: 3 });
    const r = await new DataQualityService(prisma as never).run(
      tenant,
      'NGN',
      NOW,
    );
    const check = r.checks.find(
      (c) => c.key === 'flight_bookings_missing_cost',
    );
    expect(check).toMatchObject({
      count: 3,
      severity: 'WARNING',
      affects: ['gross_margin'],
      sampleIds: ['f1'],
    });
    expect(r.status).toBe('ISSUES');
    expect(JSON.stringify(r)).not.toMatch(/email|phone|passport|name"/i);
  });

  it('treats payments on voided invoices as an ERROR', async () => {
    const { prisma } = makePrisma({ voidPay: 2 });
    const r = await new DataQualityService(prisma as never).run(
      tenant,
      'NGN',
      NOW,
    );
    expect(
      r.checks.find((c) => c.key === 'payments_on_void_invoices'),
    ).toMatchObject({ count: 2, severity: 'ERROR' });
    expect(r.summary.errors).toBe(1);
  });

  it('every tenant check is tenant-scoped, and platform-only checks never run for a tenant', async () => {
    const { prisma, wheres } = makePrisma({
      flight: 1,
      voidPay: 1,
      payable: 1,
    });
    const r = await new DataQualityService(prisma as never).run(
      tenant,
      'NGN',
      NOW,
    );
    for (const w of wheres) expect(w).toContain('co-A');
    expect(prisma.invoice.count).not.toHaveBeenCalled();
    expect(prisma.journalEntry.count).not.toHaveBeenCalled();
    expect(r.checks.map((c) => c.key)).not.toContain('ledger_reversed_entries');
  });

  it('the super admin also sees the platform-only checks', async () => {
    const { prisma } = makePrisma({ orphan: 4, reversed: 7 });
    const r = await new DataQualityService(prisma as never).run(
      platform,
      'NGN',
      NOW,
    );
    expect(
      r.checks.find((c) => c.key === 'invoices_without_customer')?.count,
    ).toBe(4);
    expect(
      r.checks.find((c) => c.key === 'ledger_reversed_entries')?.count,
    ).toBe(7);
  });
});
