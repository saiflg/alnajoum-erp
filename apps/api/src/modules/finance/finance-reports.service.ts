import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScopeService,
  customerTenant,
  ReportScope,
  staffTenant,
} from '../analytics/analytics-scope.service';
import {
  ACCOUNT_CODES,
  isDebitNormal,
} from './constants/account-codes.constant';
import { LedgerService } from './ledger.service';
import { CompanyInvestmentsService } from './company-investments.service';

interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Every report in spec #17/#18/#21/#24/#25/#26/#27 reads FROM the ledger
 * (plus a handful of source tables for figures the ledger doesn't carry a
 * receivables-accrual view of yet — see the class-level note below) rather
 * than recomputing its own notion of revenue/cost/profit — one number,
 * many views.
 *
 * Known simplification (documented for the Phase 6 QA report): revenue is
 * recognized on actual payment received, not at invoice issuance, so the
 * seeded "Customer Receivables" chart-of-accounts line stays at zero —
 * outstanding invoice balances are still fully visible via the existing
 * Invoices screens, just not yet folded into this ledger.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly investments: CompanyInvestmentsService,
    private readonly scopes: AnalyticsScopeService,
  ) {}

  /**
   * The ledger (JournalEntry / LedgerAccount) and company investments have no
   * companyId, and a join through `sourceId` would be invented rather than
   * known, so the figures built from them cannot be split per tenant. Until the
   * ledger carries a tenant they are SUPER_ADMIN (platform-wide) only; a tenant
   * caller is refused instead of being shown every company's money. Per-company
   * revenue/collections are available from /analytics/* meanwhile.
   */
  private requirePlatformLedger(user: AuthContext): void {
    if (this.scopes.tenantOf(user) !== undefined) {
      throw new ForbiddenException(
        'The general ledger is not yet separated per company, so this report is limited to platform administrators. Use the executive analytics for figures on your own company.',
      );
    }
  }

  private whereCreatedAt(range: DateRange) {
    if (!range.from && !range.to) return {};
    return {
      createdAt: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    };
  }

  /** Spec #17. */
  async profitAndLoss(user: AuthContext, range: DateRange) {
    this.requirePlatformLedger(user);
    const entries = await this.prisma.journalEntry.findMany({
      where: { status: 'POSTED', ...this.whereCreatedAt(range) },
      include: { debitAccount: true, creditAccount: true },
    });

    const movementByCode = new Map<
      string,
      { name: string; type: AccountType; amount: number }
    >();
    const bump = (
      code: string,
      name: string,
      type: AccountType,
      delta: number,
    ) => {
      const cur = movementByCode.get(code) ?? { name, type, amount: 0 };
      cur.amount += delta;
      movementByCode.set(code, cur);
    };
    for (const e of entries) {
      bump(
        e.debitAccount.code,
        e.debitAccount.name,
        e.debitAccount.type,
        isDebitNormal(e.debitAccount.type) ? e.amount : -e.amount,
      );
      bump(
        e.creditAccount.code,
        e.creditAccount.name,
        e.creditAccount.type,
        isDebitNormal(e.creditAccount.type) ? -e.amount : e.amount,
      );
    }
    const line = (code: string) => ({
      code,
      name: movementByCode.get(code)?.name ?? code,
      amount: movementByCode.get(code)?.amount ?? 0,
    });

    const revenueCodes = [
      ACCOUNT_CODES.FLIGHT_REVENUE,
      ACCOUNT_CODES.VISA_REVENUE,
      ACCOUNT_CODES.HOTEL_REVENUE,
      ACCOUNT_CODES.HAJJ_REVENUE,
      ACCOUNT_CODES.UMRAH_REVENUE,
      ACCOUNT_CODES.SERVICE_FEES,
      ACCOUNT_CODES.OTHER_REVENUE,
    ];
    const revenueLines = revenueCodes.map(line);
    const totalRevenue = revenueLines.reduce((s, l) => s + l.amount, 0);

    const costOfServices = line(ACCOUNT_CODES.COST_OF_SERVICES).amount;
    const grossProfit = totalRevenue - costOfServices;

    const operatingExpenseCodes = [
      ACCOUNT_CODES.STAFF_EXPENSES,
      ACCOUNT_CODES.OFFICE_EXPENSES,
      ACCOUNT_CODES.MARKETING,
      ACCOUNT_CODES.HOSTING,
      ACCOUNT_CODES.API_COSTS,
      ACCOUNT_CODES.BANK_CHARGES,
    ];
    const operatingExpenseLines = operatingExpenseCodes.map(line);
    const totalOperatingExpenses = operatingExpenseLines.reduce(
      (s, l) => s + l.amount,
      0,
    );
    const operatingProfit = grossProfit - totalOperatingExpenses;

    const otherExpenseCodes = [
      ACCOUNT_CODES.OTHER_EXPENSES,
      ACCOUNT_CODES.REFUND_LOSSES,
    ];
    const otherExpenseLines = otherExpenseCodes.map(line);
    const totalOtherExpenses = otherExpenseLines.reduce(
      (s, l) => s + l.amount,
      0,
    );

    const netProfit = operatingProfit - totalOtherExpenses;

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      revenueLines,
      totalRevenue,
      costOfServices,
      grossProfit,
      operatingExpenseLines,
      totalOperatingExpenses,
      operatingProfit,
      otherExpenseLines,
      totalOtherExpenses,
      netProfit,
    };
  }

  /** Spec #18 — investment inflows kept separate from operating revenue via sourceModule. */
  async cashFlow(user: AuthContext, range: DateRange) {
    this.requirePlatformLedger(user);
    const cashAccounts = await this.prisma.ledgerAccount.findMany({
      where: {
        code: { in: [ACCOUNT_CODES.CASH, ACCOUNT_CODES.BANK_ACCOUNTS] },
      },
    });
    const ids = cashAccounts.map((a) => a.id);
    if (ids.length === 0) {
      return {
        from: range.from ?? null,
        to: range.to ?? null,
        inflow: 0,
        outflow: 0,
        net: 0,
        inflowBySource: {},
        outflowBySource: {},
      };
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        OR: [{ debitAccountId: { in: ids } }, { creditAccountId: { in: ids } }],
        ...this.whereCreatedAt(range),
      },
    });

    let inflow = 0;
    let outflow = 0;
    const inflowBySource: Record<string, number> = {};
    const outflowBySource: Record<string, number> = {};
    for (const e of entries) {
      if (ids.includes(e.debitAccountId)) {
        inflow += e.amount;
        inflowBySource[e.sourceModule] =
          (inflowBySource[e.sourceModule] ?? 0) + e.amount;
      }
      if (ids.includes(e.creditAccountId)) {
        outflow += e.amount;
        outflowBySource[e.sourceModule] =
          (outflowBySource[e.sourceModule] ?? 0) + e.amount;
      }
    }

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      inflow,
      outflow,
      net: inflow - outflow,
      inflowBySource,
      outflowBySource,
    };
  }

  /** Spec #26. */
  async dashboardKpis(user: AuthContext) {
    this.requirePlatformLedger(user);
    const [
      pl,
      cash,
      position,
      cashBalance,
      bankBalance,
      walletLiability,
      staffIncentivePayable,
      supplierPayables,
      incentivesPending,
      incentivesApproved,
      payoutsPending,
      payoutsSuccessful,
    ] = await Promise.all([
      this.profitAndLoss(user, {}),
      this.cashFlow(user, {}),
      this.investments.position(),
      this.ledger.getAccountBalance(ACCOUNT_CODES.CASH),
      this.ledger.getAccountBalance(ACCOUNT_CODES.BANK_ACCOUNTS),
      this.ledger.getAccountBalance(ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY),
      this.ledger.getAccountBalance(ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE),
      this.ledger.getAccountBalance(ACCOUNT_CODES.SUPPLIER_PAYABLES),
      this.prisma.staffIncentive.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.staffIncentive.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.staffPayout.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.staffPayout.aggregate({
        where: { status: 'SUCCESSFUL' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      totalRevenue: pl.totalRevenue,
      grossProfit: pl.grossProfit,
      netProfit: pl.netProfit,
      totalExpenses: pl.totalOperatingExpenses + pl.totalOtherExpenses,
      cashPosition: cashBalance,
      bankPosition: bankBalance,
      customerWalletLiability: walletLiability,
      staffIncentivePayable,
      supplierPayables,
      companyInvestmentPosition: position.totalInvested,
      incentivesPending: {
        count: incentivesPending._count,
        amount: incentivesPending._sum.amount ?? 0,
      },
      incentivesApproved: {
        count: incentivesApproved._count,
        amount: incentivesApproved._sum.amount ?? 0,
      },
      payoutsPending: {
        count: payoutsPending._count,
        amount: payoutsPending._sum.amount ?? 0,
      },
      payoutsSuccessful: {
        count: payoutsSuccessful._count,
        amount: payoutsSuccessful._sum.amount ?? 0,
      },
      refunds:
        pl.otherExpenseLines.find((l) => l.code === ACCOUNT_CODES.REFUND_LOSSES)
          ?.amount ?? 0,
      cashFlowNet: cash.net,
    };
  }

  /** Spec #21 — derived from the source records directly (bookings/expenses/incentives already carry branchId) rather than a per-branch ledger fork, since this chart of accounts is company-wide (see LedgerAccount's doc comment). */
  async branchAccounting(user: AuthContext) {
    // Only the caller's own company's branches — and for a branch manager only
    // their own branch.
    const scope = await this.scopes.resolve(user);
    const branches = await this.prisma.branch.findMany({
      where: {
        isActive: true,
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchId ? { id: scope.branchId } : {}),
      },
    });
    return Promise.all(
      branches.map(async (branch) => {
        const [flightRevenue, hotelRevenue, expensesPaid, incentives] =
          await Promise.all([
            this.prisma.flightBooking.aggregate({
              where: {
                branchId: branch.id,
                ...customerTenant(scope),
                status: { notIn: ['CANCELLED', 'FAILED'] },
              },
              _sum: { totalAmount: true },
            }),
            this.prisma.hotelBooking.aggregate({
              where: {
                branchId: branch.id,
                ...customerTenant(scope),
                status: { notIn: ['CANCELLED', 'REFUNDED'] },
              },
              _sum: { totalAmount: true },
            }),
            this.prisma.expense.aggregate({
              where: {
                branchId: branch.id,
                ...(scope.companyId
                  ? { createdByStaff: { companyId: scope.companyId } }
                  : {}),
                status: 'PAID',
              },
              _sum: { amount: true },
            }),
            this.prisma.staffIncentive.aggregate({
              where: {
                staff: {
                  branchId: branch.id,
                  ...(scope.companyId ? { companyId: scope.companyId } : {}),
                },
                status: { not: 'REJECTED' },
              },
              _sum: { amount: true },
            }),
          ]);
        const revenue =
          (flightRevenue._sum.totalAmount ?? 0) +
          (hotelRevenue._sum.totalAmount ?? 0);
        const expenseTotal = expensesPaid._sum.amount ?? 0;
        const incentiveTotal = incentives._sum.amount ?? 0;
        return {
          branchId: branch.id,
          branchName: branch.name,
          revenue,
          expenses: expenseTotal,
          staffIncentives: incentiveTotal,
          profit: revenue - expenseTotal - incentiveTotal,
        };
      }),
    );
  }

  /** Spec #24 — no internal cost/margin fields exposed. */
  async customerStatement(
    user: AuthContext,
    customerId: string,
    range: DateRange,
  ) {
    // Another company's customer is a 404, indistinguishable from no such id.
    const scope = this.scopes.tenantScope(user);
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
      },
      select: { firstName: true, lastName: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const dateFilter = this.whereCreatedAt(range);
    const [invoices, payments, walletTransactions] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { customerId, ...customerTenant(scope), ...dateFilter },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          currency: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: {
          invoice: { customerId, ...customerTenant(scope) },
          ...(range.from || range.to ? { paidAt: dateFilter.createdAt } : {}),
        },
        select: {
          paymentReference: true,
          amount: true,
          method: true,
          paidAt: true,
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          wallet: { customerId, ...customerTenant(scope) },
          ...dateFilter,
        },
        select: {
          reference: true,
          type: true,
          amount: true,
          description: true,
          createdAt: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const serviceCharges = invoices.reduce((sum, i) => sum + i.totalAmount, 0);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const walletDeposits = walletTransactions
      .filter((t) => t.type === 'DEPOSIT' && t.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.amount, 0);
    const refunds = walletTransactions
      .filter((t) => t.type === 'REFUND' && t.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      customer: `${customer.firstName} ${customer.lastName}`,
      from: range.from ?? null,
      to: range.to ?? null,
      openingBalance: 0, // no period-rollover tracking — every statement is computed fresh over the requested range
      invoices,
      payments,
      walletTransactions,
      serviceCharges,
      totalPaid,
      walletDeposits,
      refunds,
      closingBalance: serviceCharges - totalPaid,
    };
  }

  /** Spec #25. */
  async staffIncentiveStatement(
    user: AuthContext,
    staffId: string,
    self = false,
  ) {
    // Another company's staff member is a 404 (and a branch manager is held to
    // their own branch's staff). `self` is the caller's own record, in scope by
    // construction.
    const scope: ReportScope = self
      ? this.scopes.tenantScope(user)
      : await this.scopes.resolve(user);
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: staffId,
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchLocked && scope.branchId
          ? { branchId: scope.branchId }
          : {}),
      },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    const incentives = await this.prisma.staffIncentive.findMany({
      where: { staffId, ...staffTenant(scope) },
      include: { payout: true },
      orderBy: { createdAt: 'desc' },
    });

    const generated = incentives.reduce((s, i) => s + i.amount, 0);
    const pending = incentives
      .filter((i) => i.status === 'PENDING')
      .reduce((s, i) => s + i.amount, 0);
    const approved = incentives
      .filter((i) => i.status === 'APPROVED')
      .reduce((s, i) => s + i.amount, 0);
    const paid = incentives
      .filter((i) => i.status === 'PAID')
      .reduce((s, i) => s + i.amount, 0);
    const failedPayouts = incentives.filter(
      (i) => i.payout?.status === 'FAILED',
    );

    return {
      staff: `${staff.firstName} ${staff.lastName} (${staff.employeeCode})`,
      totalGenerated: generated,
      pending,
      approved,
      availableBalance: approved, // APPROVED and not yet PAID = awaiting payout
      totalPaid: paid,
      failedPayoutCount: failedPayouts.length,
      incentives,
    };
  }

  /** Spec #27 — one transaction, fully explained. */
  async transactionProfitability(
    user: AuthContext,
    sourceType: string,
    sourceId: string,
  ) {
    // Located through the earning staff member, so another company's
    // transaction is the same 404 as one that does not exist.
    const scope = await this.scopes.resolve(user);
    const incentive = await this.prisma.staffIncentive.findFirst({
      where: {
        sourceType,
        sourceId,
        staff: {
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchLocked && scope.branchId
            ? { branchId: scope.branchId }
            : {}),
        },
      },
      include: { staff: { select: { firstName: true, lastName: true } } },
    });
    if (!incentive) {
      throw new NotFoundException(
        'No incentive record found for this transaction',
      );
    }
    const companyShare =
      incentive.margin != null ? incentive.margin - incentive.amount : null;
    return {
      sourceType,
      sourceId,
      customerPrice: incentive.sellingPrice,
      companyCost: incentive.companyCost,
      grossMargin: incentive.margin,
      staffIncentive: incentive.amount,
      companyShare,
      staff: `${incentive.staff.firstName} ${incentive.staff.lastName}`,
      status: incentive.status,
    };
  }
}
