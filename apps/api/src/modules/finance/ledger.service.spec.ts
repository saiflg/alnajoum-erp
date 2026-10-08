import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType, JournalEntryStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: Record<string, any>;
  let auditService: { record: jest.Mock };

  const accounts: Record<
    string,
    { id: string; code: string; type: AccountType }
  > = {
    '1000': { id: 'acc-cash', code: '1000', type: AccountType.ASSET },
    '4000': {
      id: 'acc-flight-revenue',
      code: '4000',
      type: AccountType.REVENUE,
    },
    '5080': {
      id: 'acc-cost-of-services',
      code: '5080',
      type: AccountType.EXPENSE,
    },
    '2030': {
      id: 'acc-supplier-payables',
      code: '2030',
      type: AccountType.LIABILITY,
    },
  };

  beforeEach(async () => {
    prisma = {
      ledgerAccount: {
        upsert: jest.fn(),
        findUnique: jest.fn((args: { where: { code: string } }) =>
          Promise.resolve(accounts[args.where.code] ?? null),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'entry-1', ...args.data }),
        ),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(LedgerService);
  });

  describe('post', () => {
    it('spec #3: rejects a non-positive amount — no zero or negative entries are ever posted', async () => {
      await expect(
        service.post({
          debitCode: '1000',
          creditCode: '4000',
          amount: 0,
          currency: 'NGN',
          reference: 'REF-1',
          description: 'test',
          sourceModule: 'PAYMENT',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.post({
          debitCode: '1000',
          creditCode: '4000',
          amount: -500,
          currency: 'NGN',
          reference: 'REF-1',
          description: 'test',
          sourceModule: 'PAYMENT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects debiting and crediting the same account', async () => {
      await expect(
        service.post({
          debitCode: '1000',
          creditCode: '1000',
          amount: 1000,
          currency: 'NGN',
          reference: 'REF-1',
          description: 'test',
          sourceModule: 'PAYMENT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when a code has no seeded account rather than silently posting nowhere', async () => {
      await expect(
        service.post({
          debitCode: '9999',
          creditCode: '4000',
          amount: 1000,
          currency: 'NGN',
          reference: 'REF-1',
          description: 'test',
          sourceModule: 'PAYMENT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('spec #3: every posted entry balances by construction — one debit account, one credit account, one amount', async () => {
      const entry = await service.post({
        debitCode: '1000',
        creditCode: '4000',
        amount: 68_250,
        currency: 'NGN',
        reference: 'PAY-1',
        description: 'Payment for invoice INV-1',
        sourceModule: 'PAYMENT',
        sourceId: 'payment-1',
        companyId: 'company-1',
      });

      expect(prisma.journalEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitAccountId: 'acc-cash',
          creditAccountId: 'acc-flight-revenue',
          amount: 68_250,
          currency: 'NGN',
          sourceModule: 'PAYMENT',
          sourceId: 'payment-1',
          companyId: 'company-1',
        }),
      });
      expect(entry.amount).toBe(68_250);
    });

    it('rounds the amount to the nearest whole currency unit', async () => {
      await service.post({
        debitCode: '1000',
        creditCode: '4000',
        amount: 999.6,
        currency: 'NGN',
        reference: 'REF-1',
        description: 'test',
        sourceModule: 'PAYMENT',
        companyId: 'company-1',
      });

      expect(prisma.journalEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 1000 }),
        }),
      );
    });
  });

  describe('reverseEntry', () => {
    it('spec #3: never deletes the original — posts a new entry with accounts swapped and flips the original to REVERSED', async () => {
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        debitAccountId: 'acc-cash',
        creditAccountId: 'acc-flight-revenue',
        amount: 68_250,
        currency: 'NGN',
        reference: 'PAY-1',
        description: 'Payment for invoice INV-1',
        sourceModule: 'PAYMENT',
        sourceId: 'payment-1',
        branchId: null,
        companyId: 'company-1',
        status: JournalEntryStatus.POSTED,
      });
      prisma.journalEntry.create.mockResolvedValue({ id: 'entry-2' });

      const reversal = await service.reverseEntry(
        'entry-1',
        'Booking refunded',
        'identity-1',
      );

      expect(prisma.journalEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitAccountId: 'acc-flight-revenue', // swapped
          creditAccountId: 'acc-cash', // swapped
          amount: 68_250,
          reversalOfId: 'entry-1',
        }),
      });
      expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'entry-1', status: JournalEntryStatus.POSTED },
        data: { status: JournalEntryStatus.REVERSED },
      });
      // The reversal stays in the same company's books as the entry it reverses.
      expect(prisma.journalEntry.create.mock.calls[0][0].data.companyId).toBe(
        'company-1',
      );
      expect(reversal.id).toBe('entry-2');
    });

    it('refuses to reverse an already-reversed entry', async () => {
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: JournalEntryStatus.REVERSED,
      });

      await expect(service.reverseEntry('entry-1', 'reason')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('per-company books (Phase 22 S-11)', () => {
    const entryOf = (companyId: string) => ({
      id: 'entry-1',
      debitAccountId: 'acc-cash',
      creditAccountId: 'acc-flight-revenue',
      amount: 100,
      currency: 'NGN',
      reference: 'R',
      description: 'd',
      sourceModule: 'PAYMENT',
      sourceId: 'p1',
      branchId: null,
      companyId,
      status: JournalEntryStatus.POSTED,
    });

    it("a tenant cannot reverse another company's entry (it looks like a missing entry)", async () => {
      prisma.journalEntry.findUnique.mockResolvedValue(entryOf('company-2'));
      await expect(
        service.reverseEntry('entry-1', 'x', 'identity-1', 'company-1'),
      ).rejects.toThrow('Journal entry not found');
      expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it("a SUPER_ADMIN (no tenant) may reverse any company's entry", async () => {
      prisma.journalEntry.findUnique.mockResolvedValue(entryOf('company-2'));
      prisma.journalEntry.create.mockResolvedValue({ id: 'entry-2' });
      await expect(
        service.reverseEntry('entry-1', 'x', 'identity-1'),
      ).resolves.toBeDefined();
    });

    it('two simultaneous reversals cannot both succeed', async () => {
      prisma.journalEntry.findUnique.mockResolvedValue(entryOf('company-1'));
      prisma.journalEntry.updateMany.mockResolvedValue({ count: 0 }); // somebody else got there first
      await expect(
        service.reverseEntry('entry-1', 'x', 'identity-1', 'company-1'),
      ).rejects.toThrow('already reversed');
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('refuses to post an entry that belongs to no company', async () => {
      await expect(
        service.post({
          debitCode: '1000',
          creditCode: '4000',
          amount: 5,
          currency: 'NGN',
          reference: 'R',
          description: 'd',
          sourceModule: 'MISC',
        }),
      ).rejects.toThrow(/which company/);
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it("derives the company from the record being posted for (a payment's invoice's customer)", async () => {
      prisma.payment = {
        findUnique: jest.fn().mockResolvedValue({
          invoice: {
            customer: { companyId: 'company-9' },
            issuedByStaff: null,
            corporateBooking: null,
          },
        }),
      };
      await service.post({
        debitCode: '1000',
        creditCode: '4000',
        amount: 5,
        currency: 'NGN',
        reference: 'R',
        description: 'd',
        sourceModule: 'PAYMENT',
        sourceId: 'pay-1',
      });
      expect(prisma.journalEntry.create.mock.calls[0][0].data.companyId).toBe(
        'company-9',
      );
    });

    it('balances, trial balance and entry lists are confined to the company when one is given', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([accounts['1000']]);
      prisma.journalEntry.findMany = jest.fn().mockResolvedValue([]);
      await service.getAccountBalance('1000', undefined, 'company-1');
      await service.getAccountMovement(
        '1000',
        undefined,
        undefined,
        'company-1',
      );
      await service.trialBalance(undefined, 'company-1');
      await service.listEntries({}, 'company-1');
      for (const call of prisma.journalEntry.aggregate.mock.calls) {
        expect(call[0].where.companyId).toBe('company-1');
      }
      expect(
        prisma.journalEntry.findMany.mock.calls[0][0].where.companyId,
      ).toBe('company-1');
    });

    it('without a company, balances span every company (SUPER_ADMIN)', async () => {
      await service.getAccountBalance('1000');
      expect(
        prisma.journalEntry.aggregate.mock.calls[0][0].where,
      ).not.toHaveProperty('companyId');
    });
  });

  describe('getAccountBalance', () => {
    it('signs a debit-normal account (Asset) as debit minus credit', async () => {
      prisma.journalEntry.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 100_000 } }) // debit sum
        .mockResolvedValueOnce({ _sum: { amount: 30_000 } }); // credit sum

      const balance = await service.getAccountBalance('1000');
      expect(balance).toBe(70_000);
    });

    it('signs a credit-normal account (Revenue) as credit minus debit', async () => {
      prisma.journalEntry.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10_000 } }) // debit sum
        .mockResolvedValueOnce({ _sum: { amount: 68_250 } }); // credit sum

      const balance = await service.getAccountBalance('4000');
      expect(balance).toBe(58_250);
    });

    it('returns 0 for an unknown account code rather than throwing', async () => {
      const balance = await service.getAccountBalance('9999');
      expect(balance).toBe(0);
    });
  });
});
