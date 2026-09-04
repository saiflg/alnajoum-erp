import { Injectable } from '@nestjs/common';
import {
  CompanyInvestment,
  Expense,
  IncentiveStatus,
  Invoice,
  InvestmentType,
  JournalEntryStatus,
  Payment,
  PaymentMethod,
  StaffIncentive,
  StaffPayout,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ACCOUNT_CODES } from './constants/account-codes.constant';
import { LedgerService } from './ledger.service';

/**
 * Business-event-shaped wrappers around LedgerService.post() — one method
 * per kind of money movement in the platform, so every module posts
 * consistent debit/credit pairs without re-deriving "which account for
 * which payment method" logic itself. LedgerService stays a pure
 * generic double-entry primitive; this is where the accounting judgment
 * calls (spec #9/#10's revenue-cost-margin flow) actually live.
 */
@Injectable()
export class FinancePostingService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  private revenueAccountForInvoice(invoice: Invoice): string {
    if (invoice.flightBookingId) return ACCOUNT_CODES.FLIGHT_REVENUE;
    if (invoice.hotelBookingId) return ACCOUNT_CODES.HOTEL_REVENUE;
    if (invoice.visaApplicationId) return ACCOUNT_CODES.VISA_REVENUE;
    if (invoice.hajjRegistrationId) return ACCOUNT_CODES.HAJJ_REVENUE;
    if (invoice.umrahRegistrationId) return ACCOUNT_CODES.UMRAH_REVENUE;
    if (invoice.corporateBookingId) return ACCOUNT_CODES.SERVICE_FEES;
    // Vehicle rentals, flight group bookings, and travel packages (the
    // latter two have no scalar FK on Invoice to check without an extra
    // query — see Invoice's own doc comment in schema.prisma) fall back
    // here; still fully counted in total revenue, just not broken out by
    // service in the by-service P&L split.
    return ACCOUNT_CODES.OTHER_REVENUE;
  }

  private cashSideForMethod(method: PaymentMethod): string {
    switch (method) {
      case PaymentMethod.CASH:
        return ACCOUNT_CODES.CASH;
      case PaymentMethod.WALLET:
        return ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY;
      default:
        return ACCOUNT_CODES.BANK_ACCOUNTS;
    }
  }

  /** Every path that creates a real Payment row (staff record, online checkout, wallet payment, approved manual payment) calls this right after — spec #4's step 7 ("ledger entry is created") and step 9 ("relevant service balance is updated"). */
  async postRevenueForPayment(
    payment: Payment,
    invoice: Invoice,
  ): Promise<void> {
    await this.ledger.post({
      debitCode: this.cashSideForMethod(payment.method),
      creditCode: this.revenueAccountForInvoice(invoice),
      amount: payment.amount,
      currency: invoice.currency,
      reference: payment.paymentReference,
      description: `Payment ${payment.paymentReference} for invoice ${invoice.invoiceNumber}`,
      sourceModule: 'PAYMENT',
      sourceId: payment.id,
    });
  }

  /**
   * Recognizes what we owe a supplier the moment the obligation is
   * actually incurred (a flight is ticketed, a hotel booking completed, a
   * visa application's company cost is confirmed) rather than spread
   * across the customer's own payment installments — standard accrual
   * treatment for cost of services, and what feeds spec #20's supplier
   * payables tracking. Idempotent: a second call for the same booking
   * (e.g. a retry) is a silent no-op, since a SupplierPayable already
   * exists for it.
   */
  async postCostOfServiceForBooking(params: {
    sourceModule: 'FLIGHT_BOOKING' | 'HOTEL_BOOKING' | 'VISA_APPLICATION';
    sourceId: string;
    supplierName: string;
    amount: number;
    currency: string;
    dueDate?: Date;
  }): Promise<void> {
    if (params.amount <= 0) return;

    const existing = await this.prisma.supplierPayable.findFirst({
      where: { sourceModule: params.sourceModule, sourceId: params.sourceId },
    });
    if (existing) return;

    await this.prisma.supplierPayable.create({
      data: {
        supplierName: params.supplierName,
        sourceModule: params.sourceModule,
        sourceId: params.sourceId,
        amount: params.amount,
        currency: params.currency,
        dueDate: params.dueDate,
      },
    });

    await this.ledger.post({
      debitCode: ACCOUNT_CODES.COST_OF_SERVICES,
      creditCode: ACCOUNT_CODES.SUPPLIER_PAYABLES,
      amount: params.amount,
      currency: params.currency,
      reference: `COST-${params.sourceId}`,
      description: `Supplier cost for ${params.sourceModule.replace('_', ' ').toLowerCase()} ${params.sourceId} (${params.supplierName})`,
      sourceModule: params.sourceModule,
      sourceId: params.sourceId,
    });
  }

  /** Recognizes the incentive as an owed expense the moment Finance approves it (spec #10/#11 — APPROVED, not yet paid). */
  async postIncentiveApproved(incentive: StaffIncentive): Promise<void> {
    await this.ledger.post({
      debitCode: ACCOUNT_CODES.STAFF_EXPENSES,
      creditCode: ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE,
      amount: incentive.amount,
      currency: incentive.currency,
      reference: incentive.referenceNumber ?? incentive.id,
      description: `Staff incentive approved: ${incentive.description}`,
      sourceModule: 'INCENTIVE',
      sourceId: incentive.id,
    });
  }

  /** Clears the payable and records the actual cash-out once a payout provider confirms success (spec #13's "create accounting entry"). */
  async postIncentivePaid(payout: StaffPayout): Promise<void> {
    await this.ledger.post({
      debitCode: ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE,
      creditCode: ACCOUNT_CODES.BANK_ACCOUNTS,
      amount: payout.amount,
      currency: payout.currency,
      reference: payout.providerReference ?? payout.id,
      description: `Incentive payout ${payout.id} paid via ${payout.provider}`,
      sourceModule: 'PAYOUT',
      sourceId: payout.id,
    });
  }

  /** Spec #18's "Refund Losses" expense line — always a real cash/wallet outflow, never a silent revenue reversal. */
  async postRefund(params: {
    amount: number;
    currency: string;
    reference: string;
    description: string;
    sourceModule: string;
    sourceId: string;
    toWallet?: boolean;
  }): Promise<void> {
    if (params.amount <= 0) return;
    await this.ledger.post({
      debitCode: ACCOUNT_CODES.REFUND_LOSSES,
      creditCode: params.toWallet
        ? ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY
        : ACCOUNT_CODES.BANK_ACCOUNTS,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      description: params.description,
      sourceModule: params.sourceModule,
      sourceId: params.sourceId,
    });
  }

  /**
   * Spec #29's "prevent double refunds / manipulated amounts" applied to
   * incentives specifically: a booking that gets refunded/cancelled after
   * its incentive was already earned must not leave that incentive payable
   * — called from the flight/hotel refund services. Never touches an
   * already-PAID incentive (that money already moved; a paid-out incentive
   * on a since-refunded booking is a business/collections problem, not
   * something an automatic reversal should silently paper over).
   */
  async cancelIncentivesForSource(
    sourceType: string,
    sourceId: string,
    reason: string,
  ): Promise<void> {
    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType,
        sourceId,
        status: { in: [IncentiveStatus.PENDING, IncentiveStatus.APPROVED] },
      },
    });
    for (const incentive of incentives) {
      await this.prisma.staffIncentive.update({
        where: { id: incentive.id },
        data: { status: IncentiveStatus.CANCELLED, rejectionReason: reason },
      });
      const entry = await this.prisma.journalEntry.findFirst({
        where: {
          sourceModule: 'INCENTIVE',
          sourceId: incentive.id,
          status: JournalEntryStatus.POSTED,
        },
      });
      if (entry) {
        await this.ledger.reverseEntry(entry.id, reason);
      }
    }
  }

  /** Spec #15/#16 — equity, never revenue; a WITHDRAWAL reduces equity directly rather than posting as an operating expense. */
  async postInvestment(investment: CompanyInvestment): Promise<void> {
    const reference = investment.reference ?? investment.id;
    if (investment.type === InvestmentType.WITHDRAWAL) {
      await this.ledger.post({
        debitCode: ACCOUNT_CODES.OWNER_EQUITY,
        creditCode: ACCOUNT_CODES.BANK_ACCOUNTS,
        amount: investment.amount,
        currency: investment.currency,
        reference,
        description: `Owner withdrawal by ${investment.investor}`,
        sourceModule: 'INVESTMENT',
        sourceId: investment.id,
      });
      return;
    }
    await this.ledger.post({
      debitCode: ACCOUNT_CODES.BANK_ACCOUNTS,
      creditCode: ACCOUNT_CODES.COMPANY_INVESTMENT,
      amount: investment.amount,
      currency: investment.currency,
      reference,
      description: `${investment.type === InvestmentType.INITIAL ? 'Initial' : 'Additional'} investment by ${investment.investor}`,
      sourceModule: 'INVESTMENT',
      sourceId: investment.id,
    });
  }

  /** Only called once an Expense is APPROVED and marked PAID — mirrors ManualPaymentSubmission's "submitting has zero ledger effect, only approval does". */
  async postExpensePaid(expense: Expense, accountCode: string): Promise<void> {
    await this.ledger.post({
      debitCode: accountCode,
      creditCode:
        expense.paymentMethod === PaymentMethod.CASH
          ? ACCOUNT_CODES.CASH
          : expense.paymentMethod === PaymentMethod.WALLET
            ? ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY
            : ACCOUNT_CODES.BANK_ACCOUNTS,
      amount: expense.amount,
      currency: expense.currency,
      reference: expense.expenseNumber,
      description: `Expense ${expense.expenseNumber}: ${expense.description}`,
      sourceModule: 'EXPENSE',
      sourceId: expense.id,
      branchId: expense.branchId ?? undefined,
    });
  }
}
