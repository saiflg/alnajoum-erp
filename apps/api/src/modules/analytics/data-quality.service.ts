import { Injectable } from '@nestjs/common';
import { InvoiceStatus, SupplierPayableStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AnalyticsScope } from './analytics-scope.service';
import {
  ACTIVE_FLIGHT_STATUSES,
  ACTIVE_HOTEL_STATUSES,
} from './engine/metric-definitions';

export type QualitySeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface QualityCheck {
  key: string;
  title: string;
  severity: QualitySeverity;
  /** How many records have the problem. */
  count: number;
  description: string;
  /** Which figures this distorts, so a reader knows how far to trust them. */
  affects: string[];
  /** Record ids only (never names or contact details), so staff can find and fix them. */
  sampleIds: string[];
}

export interface DataQualityReport {
  generatedAt: string;
  scope: string;
  status: 'CLEAN' | 'ISSUES';
  summary: { errors: number; warnings: number; info: number };
  checks: QualityCheck[];
  notes: string[];
}

const SAMPLE = 5;

/**
 * Phase 20 — read-only data-quality checks.
 *
 * It REPORTS problems; it never fixes or hides them. A "bad" row stays in the
 * source tables exactly as it was, and the metrics layer excludes (or flags) it
 * by documented rule rather than quietly patching the number.
 */
@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    scope: AnalyticsScope,
    baseCurrency: string,
    now: Date,
  ): Promise<DataQualityReport> {
    const customerRel = scope.companyId
      ? { customer: { companyId: scope.companyId } }
      : {};
    const branchRel = scope.branchId ? { branchId: scope.branchId } : {};
    const checks: QualityCheck[] = [];
    const add = (
      c: Omit<QualityCheck, 'sampleIds'> & { sampleIds?: string[] },
    ) => checks.push({ sampleIds: [], ...c });

    // Active sales whose supplier cost was never recorded -> margin cannot include them.
    const [fNoCost, hNoCost] = await Promise.all([
      this.prisma.flightBooking.findMany({
        where: {
          status: { in: ACTIVE_FLIGHT_STATUSES },
          providerCost: null,
          ...customerRel,
          ...branchRel,
        },
        select: { id: true },
        take: SAMPLE,
      }),
      this.prisma.hotelBooking.findMany({
        where: {
          status: { in: ACTIVE_HOTEL_STATUSES },
          supplierCost: null,
          ...customerRel,
          ...branchRel,
        },
        select: { id: true },
        take: SAMPLE,
      }),
    ]);
    const [fNoCostCount, hNoCostCount] = await Promise.all([
      this.prisma.flightBooking.count({
        where: {
          status: { in: ACTIVE_FLIGHT_STATUSES },
          providerCost: null,
          ...customerRel,
          ...branchRel,
        },
      }),
      this.prisma.hotelBooking.count({
        where: {
          status: { in: ACTIVE_HOTEL_STATUSES },
          supplierCost: null,
          ...customerRel,
          ...branchRel,
        },
      }),
    ]);
    add({
      key: 'flight_bookings_missing_cost',
      title: 'Flight sales with no supplier cost',
      severity: 'WARNING',
      count: fNoCostCount,
      description:
        'These flight bookings have no recorded provider cost, so they are left out of gross margin (never treated as zero cost).',
      affects: ['gross_margin'],
      sampleIds: fNoCost.map((r) => r.id),
    });
    add({
      key: 'hotel_bookings_missing_cost',
      title: 'Hotel sales with no supplier cost',
      severity: 'WARNING',
      count: hNoCostCount,
      description:
        'These hotel bookings have no recorded supplier cost, so they are left out of gross margin.',
      affects: ['gross_margin'],
      sampleIds: hNoCost.map((r) => r.id),
    });

    // Active sales with no branch -> invisible in any branch view.
    const [fNoBranch, hNoBranch] = await Promise.all([
      this.prisma.flightBooking.count({
        where: {
          status: { in: ACTIVE_FLIGHT_STATUSES },
          branchId: null,
          ...customerRel,
        },
      }),
      this.prisma.hotelBooking.count({
        where: {
          status: { in: ACTIVE_HOTEL_STATUSES },
          branchId: null,
          ...customerRel,
        },
      }),
    ]);
    if (!scope.branchId) {
      add({
        key: 'bookings_without_branch',
        title: 'Sales not attributed to a branch',
        severity: 'INFO',
        count: fNoBranch + hNoBranch,
        description:
          'These bookings appear in company totals but in no branch view.',
        affects: ['booked_value', 'bookings_count (branch view)'],
      });
    }

    // Money in a currency the company does not report in.
    const [fFx, hFx] = await Promise.all([
      this.prisma.flightBooking.count({
        where: {
          status: { in: ACTIVE_FLIGHT_STATUSES },
          NOT: { currency: baseCurrency },
          ...customerRel,
          ...branchRel,
        },
      }),
      this.prisma.hotelBooking.count({
        where: {
          status: { in: ACTIVE_HOTEL_STATUSES },
          NOT: { currency: baseCurrency },
          ...customerRel,
          ...branchRel,
        },
      }),
    ]);
    add({
      key: 'bookings_in_other_currency',
      title: `Sales not in ${baseCurrency}`,
      severity: 'WARNING',
      count: fFx + hFx,
      description: `These bookings are excluded from money totals because there is no exchange-rate history to convert them to ${baseCurrency}.`,
      affects: [
        'booked_value',
        'average_booking_value',
        'gross_margin',
        'cash_collected',
      ],
    });

    // Payments recorded against an invoice that was later voided.
    const voidPayments = await this.prisma.payment.count({
      where: { invoice: { status: InvoiceStatus.VOID, ...customerRel } },
    });
    add({
      key: 'payments_on_void_invoices',
      title: 'Payments on voided invoices',
      severity: 'ERROR',
      count: voidPayments,
      description:
        'Money was recorded against an invoice that is now void. Cash collected excludes it; finance should confirm it was refunded or re-allocated.',
      affects: ['cash_collected'],
    });

    // Payables with no due date cannot be aged.
    const payableNoDue = await this.prisma.supplierPayable.count({
      where: {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        dueDate: null,
        status: { not: SupplierPayableStatus.PAID },
      },
    });
    add({
      key: 'payables_without_due_date',
      title: 'Supplier payables with no due date',
      severity: 'WARNING',
      count: payableNoDue,
      description:
        'These cannot be aged; they are shown in a separate "No due date" bucket.',
      affects: ['supplier_payables_outstanding'],
    });

    // Platform-only: records that no company can ever see.
    if (scope.companyId === undefined) {
      const [orphanInvoices, reversed] = await Promise.all([
        this.prisma.invoice.count({
          where: { customerId: null, status: { not: InvoiceStatus.VOID } },
        }),
        this.prisma.journalEntry.count({ where: { status: 'REVERSED' } }),
      ]);
      add({
        key: 'invoices_without_customer',
        title: 'Invoices not attributable to any company',
        severity: 'WARNING',
        count: orphanInvoices,
        description:
          "Corporate invoices have no customer, so they cannot be tied to a tenant and are excluded from every tenant's cash and receivables.",
        affects: ['cash_collected', 'receivables_outstanding'],
      });
      add({
        key: 'ledger_reversed_entries',
        title: 'Reversed ledger entries',
        severity: 'INFO',
        count: reversed,
        description:
          'The existing platform P&L counts the reversal but not the reversed original, so it can disagree with account balances. Analytics deliberately does not use that P&L.',
        affects: ['ledger_profit_and_loss_per_company (unavailable)'],
      });
    }

    const problems = checks.filter((c) => c.count > 0);
    return {
      generatedAt: now.toISOString(),
      scope: scope.description,
      status: problems.length === 0 ? 'CLEAN' : 'ISSUES',
      summary: {
        errors: problems.filter((c) => c.severity === 'ERROR').length,
        warnings: problems.filter((c) => c.severity === 'WARNING').length,
        info: problems.filter((c) => c.severity === 'INFO').length,
      },
      checks,
      notes: [
        'Checks are read-only. Nothing here changes or deletes a record.',
      ],
    };
  }
}
