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

  const accounts: Record<string, { id: string; code: string; type: AccountType }> = {
    '1000': { id: 'acc-cash', code: '1000', type: AccountType.ASSET },
    '4000': { id: 'acc-flight-revenue', code: '4000', type: AccountType.REVENUE },
    '5080': { id: 'acc-cost-of-services', code: '5080', type: AccountType.EXPENSE },
    '2030': { id: 'acc-supplier-payables', code: '2030', type: AccountType.LIABILITY },
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
        create: jest.fn((args: any) => Promise.resolve({ id: 'entry-1', ...args.data })),
        update: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
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
      });

      expect(prisma.journalEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitAccountId: 'acc-cash',
          creditAccountId: 'acc-flight-revenue',
          amount: 68_250,
          currency: 'NGN',
          sourceModule: 'PAYMENT',
          sourceId: 'payment-1',
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
      });

      expect(prisma.journalEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 1000 }) }),
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
        status: JournalEntryStatus.POSTED,
      });
      prisma.journalEntry.create.mockResolvedValue({ id: 'entry-2' });

      const reversal = await service.reverseEntry('entry-1', 'Booking refunded', 'identity-1');

      expect(prisma.journalEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitAccountId: 'acc-flight-revenue', // swapped
          creditAccountId: 'acc-cash', // swapped
          amount: 68_250,
          reversalOfId: 'entry-1',
        }),
      });
      expect(prisma.journalEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { status: JournalEntryStatus.REVERSED },
      });
      expect(reversal.id).toBe('entry-2');
    });

    it('refuses to reverse an already-reversed entry', async () => {
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: JournalEntryStatus.REVERSED,
      });

      await expect(service.reverseEntry('entry-1', 'reason')).rejects.toThrow(BadRequestException);
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
