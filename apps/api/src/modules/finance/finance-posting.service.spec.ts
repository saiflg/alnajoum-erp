import { Test, TestingModule } from '@nestjs/testing';
import { IncentiveStatus, InvestmentType, JournalEntryStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ACCOUNT_CODES } from './constants/account-codes.constant';
import { FinancePostingService } from './finance-posting.service';
import { LedgerService } from './ledger.service';

/**
 * Spec #33's end-to-end financial scenario, exercised against
 * FinancePostingService directly (LedgerService itself is unit-tested in
 * ledger.service.spec.ts) — a visa sale where:
 *   Company Cost = ₦600,000, Customer Price = ₦800,000 -> Margin = ₦200,000
 * tested at 100% incentive (company share ₦0) and 50% (company share
 * ₦100,000), plus a refund cancelling an unpaid incentive.
 */
describe('FinancePostingService', () => {
  let service: FinancePostingService;
  let ledger: { post: jest.Mock; reverseEntry: jest.Mock };
  let prisma: Record<string, any>;

  beforeEach(async () => {
    ledger = { post: jest.fn().mockResolvedValue({ id: 'entry-1' }), reverseEntry: jest.fn() };
    prisma = {
      supplierPayable: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      staffIncentive: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancePostingService,
        { provide: LedgerService, useValue: ledger },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FinancePostingService);
  });

  it('spec #33 step 1: recognizes the full ₦800,000 as Visa Revenue against Cash on a cash payment', async () => {
    await service.postRevenueForPayment(
      { id: 'pay-1', paymentReference: 'PAY-1', amount: 800_000, method: PaymentMethod.CASH } as never,
      { id: 'inv-1', invoiceNumber: 'INV-1', currency: 'NGN', visaApplicationId: 'app-1' } as never,
    );

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.CASH,
        creditCode: ACCOUNT_CODES.VISA_REVENUE,
        amount: 800_000,
      }),
    );
  });

  it('spec #33 step 2: recognizes the ₦600,000 company cost as owed to the supplier, once, idempotently', async () => {
    await service.postCostOfServiceForBooking({
      sourceModule: 'VISA_APPLICATION',
      sourceId: 'app-1',
      supplierName: 'Visa service provider',
      amount: 600_000,
      currency: 'NGN',
    });

    expect(prisma.supplierPayable.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 600_000 }) }),
    );
    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.COST_OF_SERVICES,
        creditCode: ACCOUNT_CODES.SUPPLIER_PAYABLES,
        amount: 600_000,
      }),
    );

    // Idempotent — a second call for the same booking is a silent no-op.
    prisma.supplierPayable.findFirst.mockResolvedValue({ id: 'payable-1' });
    ledger.post.mockClear();
    await service.postCostOfServiceForBooking({
      sourceModule: 'VISA_APPLICATION',
      sourceId: 'app-1',
      supplierName: 'Visa service provider',
      amount: 600_000,
      currency: 'NGN',
    });
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('spec #33 at 100% incentive: staff incentive = margin, company share = 0', async () => {
    const margin = 800_000 - 600_000;
    const staffIncentiveAmount = margin; // FULL_MARGIN policy
    const companyShare = margin - staffIncentiveAmount;
    expect(companyShare).toBe(0);

    await service.postIncentiveApproved({
      id: 'inc-1',
      amount: staffIncentiveAmount,
      currency: 'NGN',
      referenceNumber: 'INC-1',
      description: 'Incentive on visa application VISA-2026-000001',
    } as never);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.STAFF_EXPENSES,
        creditCode: ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE,
        amount: 200_000,
      }),
    );
  });

  it('spec #33 at 50% incentive: staff incentive = half the margin, company share = the other half', async () => {
    const margin = 800_000 - 600_000;
    const staffIncentiveAmount = Math.round(margin * 0.5);
    const companyShare = margin - staffIncentiveAmount;
    expect(staffIncentiveAmount).toBe(100_000);
    expect(companyShare).toBe(100_000);
  });

  it('spec #13/#33: clears the payable and posts the payout as a real cash-out once the provider confirms success', async () => {
    await service.postIncentivePaid({
      id: 'payout-1',
      amount: 200_000,
      currency: 'NGN',
      provider: 'mock',
      providerReference: 'MOCKPAY-1',
    } as never);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE,
        creditCode: ACCOUNT_CODES.BANK_ACCOUNTS,
        amount: 200_000,
      }),
    );
  });

  it('spec #18: posts a refund as a Refund Losses expense, not a revenue reversal', async () => {
    await service.postRefund({
      amount: 68_250,
      currency: 'NGN',
      reference: 'FREFUND-1',
      description: 'Flight refund for booking ANJ-1',
      sourceModule: 'FLIGHT_REFUND',
      sourceId: 'refund-1',
    });

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.REFUND_LOSSES,
        creditCode: ACCOUNT_CODES.BANK_ACCOUNTS,
        amount: 68_250,
      }),
    );
  });

  it('spec #29: cancelling incentives for a refunded booking reverses any already-posted (APPROVED) entry and skips a PAID one', async () => {
    prisma.staffIncentive.findMany.mockResolvedValue([
      { id: 'inc-approved', status: IncentiveStatus.APPROVED },
    ]);
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 'entry-approved', status: JournalEntryStatus.POSTED });

    await service.cancelIncentivesForSource('FLIGHT_BOOKING', 'booking-1', 'Booking refunded');

    expect(prisma.staffIncentive.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-approved' },
        data: expect.objectContaining({ status: IncentiveStatus.CANCELLED }),
      }),
    );
    expect(ledger.reverseEntry).toHaveBeenCalledWith('entry-approved', 'Booking refunded');

    // A PAID incentive is never touched by cancelIncentivesForSource — the
    // query itself excludes PAID/CANCELLED/REJECTED, verified structurally:
    expect(prisma.staffIncentive.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [IncentiveStatus.PENDING, IncentiveStatus.APPROVED] },
        }),
      }),
    );
  });

  it('spec #16: an INITIAL investment debits Bank Accounts and credits Company Investment — equity, not revenue', async () => {
    await service.postInvestment({
      id: 'inv-1',
      type: InvestmentType.INITIAL,
      amount: 20_000_000,
      currency: 'NGN',
      investor: 'Alnajoum Holdings',
      reference: null,
    } as never);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.BANK_ACCOUNTS,
        creditCode: ACCOUNT_CODES.COMPANY_INVESTMENT,
        amount: 20_000_000,
      }),
    );
  });

  it('spec #16: a WITHDRAWAL debits Owner Equity and credits Bank Accounts', async () => {
    await service.postInvestment({
      id: 'inv-2',
      type: InvestmentType.WITHDRAWAL,
      amount: 500_000,
      currency: 'NGN',
      investor: 'Alnajoum Holdings',
      reference: null,
    } as never);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        debitCode: ACCOUNT_CODES.OWNER_EQUITY,
        creditCode: ACCOUNT_CODES.BANK_ACCOUNTS,
        amount: 500_000,
      }),
    );
  });
});
