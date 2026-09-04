import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JournalEntryStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  isDebitNormal,
  SEED_ACCOUNTS,
} from './constants/account-codes.constant';

type Client = PrismaService | Prisma.TransactionClient;

export interface PostEntryParams {
  debitCode: string;
  creditCode: string;
  amount: number;
  currency: string;
  reference: string;
  description: string;
  sourceModule: string;
  sourceId?: string;
  createdByIdentityId?: string;
  branchId?: string;
}

export function generateJournalReference(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * The reusable double-entry posting engine every money-moving module in
 * this codebase posts through (spec #1/#3) — PaymentsService, WalletService,
 * ManualPaymentsService, StaffPayoutsService, the flight/hotel refund
 * services, ExpensesService, CompanyInvestmentsService,
 * SupplierPayablesService. None of those own a second, competing notion of
 * "the balance" — the ledger is the single source of truth for financial
 * position, the same way WalletTransaction is already the single source of
 * truth for a wallet's balance (see Wallet's doc comment in schema.prisma).
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private accountIdCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Idempotently seeds the chart of accounts' well-known system accounts
   * (spec #2) — safe to call on every app boot (see FinanceModule.onModuleInit)
   * and again from the demo seed script. Never overwrites an account's
   * `type` once created, even if the constant list changes, since retyping
   * an account with existing posted entries would silently corrupt every
   * report derived from it.
   */
  async ensureSystemAccounts(): Promise<void> {
    for (const def of SEED_ACCOUNTS) {
      await this.prisma.ledgerAccount.upsert({
        where: { code: def.code },
        create: {
          code: def.code,
          name: def.name,
          type: def.type,
          isSystem: true,
        },
        update: {}, // never touch name/type of an already-seeded account from here
      });
    }
    this.accountIdCache.clear();
  }

  private async accountId(code: string, client: Client): Promise<string> {
    const cached = this.accountIdCache.get(code);
    if (cached) return cached;
    const account = await client.ledgerAccount.findUnique({ where: { code } });
    if (!account) {
      throw new BadRequestException(
        `Unknown ledger account code "${code}" — run LedgerService.ensureSystemAccounts() or create it from the Chart of Accounts screen`,
      );
    }
    this.accountIdCache.set(code, account.id);
    return account.id;
  }

  /**
   * Posts one balanced double-entry line: debits `debitCode` and credits
   * `creditCode` by exactly `amount`, which is what makes an unbalanced
   * entry structurally impossible (spec #3) — there's nothing to sum and
   * validate, the row itself already balances. Pass `client` (a
   * `$transaction` callback's `tx`) to compose this atomically with the
   * caller's own write, e.g. HotelsService.createBooking's booking-creation
   * transaction; omit it to post standalone.
   */
  async post(params: PostEntryParams, client: Client = this.prisma) {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new BadRequestException(
        `Ledger entries must have a positive amount (got ${params.amount})`,
      );
    }
    if (params.debitCode === params.creditCode) {
      throw new BadRequestException(
        'A ledger entry cannot debit and credit the same account',
      );
    }

    const [debitAccountId, creditAccountId] = await Promise.all([
      this.accountId(params.debitCode, client),
      this.accountId(params.creditCode, client),
    ]);

    const entry = await client.journalEntry.create({
      data: {
        debitAccountId,
        creditAccountId,
        amount: Math.round(params.amount),
        currency: params.currency,
        reference: params.reference,
        description: params.description,
        sourceModule: params.sourceModule,
        sourceId: params.sourceId,
        createdByIdentityId: params.createdByIdentityId,
        branchId: params.branchId,
      },
    });

    this.logger.debug(
      `Posted ${params.currency} ${entry.amount} — Dr ${params.debitCode} / Cr ${params.creditCode} (${params.sourceModule}${params.sourceId ? `:${params.sourceId}` : ''})`,
    );

    return entry;
  }

  /**
   * Reverses a POSTED entry by posting a new one with accounts swapped —
   * never edits or deletes the original (spec #3's "never permanently
   * delete posted financial transactions ... use reversal/correction
   * entries"). Both the original and the reversal remain visible forever;
   * only the original flips to REVERSED so reports know to net them out.
   */
  async reverseEntry(
    entryId: string,
    reason: string,
    actorIdentityId?: string,
  ) {
    const original = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { debitAccount: true, creditAccount: true },
    });
    if (!original) {
      throw new BadRequestException('Journal entry not found');
    }
    if (original.status === JournalEntryStatus.REVERSED) {
      throw new BadRequestException('This journal entry was already reversed');
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          debitAccountId: original.creditAccountId,
          creditAccountId: original.debitAccountId,
          amount: original.amount,
          currency: original.currency,
          reference: original.reference,
          description: `Reversal: ${reason} (of ${original.description})`,
          sourceModule: original.sourceModule,
          sourceId: original.sourceId,
          createdByIdentityId: actorIdentityId,
          branchId: original.branchId,
          reversalOfId: original.id,
        },
      });
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: JournalEntryStatus.REVERSED },
      });
      return created;
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'ledger.entry_reversed',
      entityType: 'JournalEntry',
      entityId: original.id,
      metadata: {
        reversalEntryId: reversal.id,
        reason,
        amount: original.amount,
      },
    });

    return reversal;
  }

  /**
   * Signed balance as of `asOf` (default now), following normal
   * double-entry convention: positive for a debit-normal account (Asset/
   * Expense) means "the natural direction", same for a credit-normal
   * account (Liability/Revenue/Equity) — i.e. this always returns "how much
   * of this account's own nature has accumulated", never a number a
   * non-accountant would read backwards. REVERSED entries are excluded
   * automatically since their own reversal already nets them to zero (both
   * legs stay in the sum, cancelling out) — no special-casing needed.
   */
  async getAccountBalance(code: string, asOf?: Date): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code },
    });
    if (!account) return 0;

    const dateFilter = asOf ? { createdAt: { lte: asOf } } : {};
    const [debitSum, creditSum] = await Promise.all([
      this.prisma.journalEntry.aggregate({
        where: { debitAccountId: account.id, ...dateFilter },
        _sum: { amount: true },
      }),
      this.prisma.journalEntry.aggregate({
        where: { creditAccountId: account.id, ...dateFilter },
        _sum: { amount: true },
      }),
    ]);
    const debit = debitSum._sum.amount ?? 0;
    const credit = creditSum._sum.amount ?? 0;
    return isDebitNormal(account.type) ? debit - credit : credit - debit;
  }

  /**
   * Signed movement WITHIN a date range (as opposed to getAccountBalance's
   * cumulative-since-inception figure) — what a Revenue/Expense account's
   * P&L line for one period actually means, since this system has no
   * period-closing entries that would otherwise reset those accounts to
   * zero at the start of each period (a real, documented simplification —
   * see the Phase 6 QA report).
   */
  async getAccountMovement(
    code: string,
    from?: Date,
    to?: Date,
  ): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code },
    });
    if (!account) return 0;

    const dateFilter = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    const createdAt = Object.keys(dateFilter).length
      ? { createdAt: dateFilter }
      : {};

    const [debitSum, creditSum] = await Promise.all([
      this.prisma.journalEntry.aggregate({
        where: { debitAccountId: account.id, ...createdAt },
        _sum: { amount: true },
      }),
      this.prisma.journalEntry.aggregate({
        where: { creditAccountId: account.id, ...createdAt },
        _sum: { amount: true },
      }),
    ]);
    const debit = debitSum._sum.amount ?? 0;
    const credit = creditSum._sum.amount ?? 0;
    return isDebitNormal(account.type) ? debit - credit : credit - debit;
  }

  /** Every account with its signed balance — the trial balance (spec #26's finance dashboard, and a sanity check that Assets = Liabilities + Equity + (Revenue - Expenses)). */
  async trialBalance(asOf?: Date) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return Promise.all(
      accounts.map(async (account) => ({
        code: account.code,
        name: account.name,
        type: account.type,
        balance: await this.getAccountBalance(account.code, asOf),
      })),
    );
  }

  listEntries(filters: {
    sourceModule?: string;
    sourceId?: string;
    accountCode?: string;
    from?: Date;
    to?: Date;
  }) {
    const dateFilter =
      filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {};
    return this.prisma.journalEntry.findMany({
      where: {
        sourceModule: filters.sourceModule,
        sourceId: filters.sourceId,
        ...dateFilter,
      },
      include: { debitAccount: true, creditAccount: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
