import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  /**
   * The company whose books this entry belongs to. Optional only for convenience: when omitted it is
   * derived from the record the entry is for (see resolveCompanyId) and the post fails if no company
   * can be found - an entry that belongs to nobody would appear in nobody's accounts.
   */
  companyId?: string;
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

  /**
   * Which company a posting belongs to, from the record it is for. This is the one place that knows
   * how each sourceModule reaches a company, mirrored by the SQL backfill in migration
   * 20261009030000_phase22_ledger_per_company.
   */
  async resolveCompanyId(
    params: Pick<
      PostEntryParams,
      'companyId' | 'sourceModule' | 'sourceId' | 'branchId'
    >,
    client: Client = this.prisma,
  ): Promise<string | undefined> {
    if (params.companyId) return params.companyId;
    const id = params.sourceId;
    const viaCustomer = {
      select: { customer: { select: { companyId: true } } },
    } as const;
    if (id) {
      switch (params.sourceModule) {
        case 'FLIGHT_BOOKING':
          return (
            await client.flightBooking.findUnique({
              where: { id },
              ...viaCustomer,
            })
          )?.customer.companyId;
        case 'HOTEL_BOOKING':
          return (
            await client.hotelBooking.findUnique({
              where: { id },
              ...viaCustomer,
            })
          )?.customer.companyId;
        case 'VISA_APPLICATION':
          return (
            await client.visaApplication.findUnique({
              where: { id },
              ...viaCustomer,
            })
          )?.customer.companyId;
        case 'FLIGHT_REFUND':
          return (
            await client.flightRefund.findUnique({
              where: { id },
              select: {
                booking: {
                  select: { customer: { select: { companyId: true } } },
                },
              },
            })
          )?.booking.customer.companyId;
        case 'FLIGHT_VOID':
          return (
            await client.flightVoid.findUnique({
              where: { id },
              select: {
                booking: {
                  select: { customer: { select: { companyId: true } } },
                },
              },
            })
          )?.booking.customer.companyId;
        case 'HOTEL_REFUND':
          return (
            await client.hotelRefund.findUnique({
              where: { id },
              select: {
                booking: {
                  select: { customer: { select: { companyId: true } } },
                },
              },
            })
          )?.booking.customer.companyId;
        case 'VISA_REFUND':
          return (
            await client.visaRefund.findUnique({
              where: { id },
              select: {
                application: {
                  select: { customer: { select: { companyId: true } } },
                },
              },
            })
          )?.application.customer.companyId;
        case 'PAYMENT': {
          const payment = await client.payment.findUnique({
            where: { id },
            select: {
              invoice: {
                select: {
                  customer: { select: { companyId: true } },
                  issuedByStaff: { select: { companyId: true } },
                  corporateBooking: {
                    select: { bookedByStaff: { select: { companyId: true } } },
                  },
                },
              },
            },
          });
          const inv = payment?.invoice;
          return (
            inv?.customer?.companyId ??
            inv?.issuedByStaff?.companyId ??
            inv?.corporateBooking?.bookedByStaff.companyId
          );
        }
        case 'WALLET':
          return (
            await client.walletTransaction.findUnique({
              where: { id },
              select: {
                wallet: {
                  select: { customer: { select: { companyId: true } } },
                },
              },
            })
          )?.wallet.customer.companyId;
        case 'EXPENSE':
          return (
            await client.expense.findUnique({
              where: { id },
              select: { createdByStaff: { select: { companyId: true } } },
            })
          )?.createdByStaff.companyId;
        case 'INCENTIVE':
          return (
            await client.staffIncentive.findUnique({
              where: { id },
              select: { staff: { select: { companyId: true } } },
            })
          )?.staff.companyId;
        case 'PAYOUT':
          return (
            await client.staffPayout.findUnique({
              where: { id },
              select: { staff: { select: { companyId: true } } },
            })
          )?.staff.companyId;
        case 'SUPPLIER_PAYMENT':
          // sourceId is the SupplierPayment; the company belongs to the payable it settles.
          return (
            await client.supplierPayment.findUnique({
              where: { id },
              select: { payable: { select: { companyId: true } } },
            })
          )?.payable.companyId;
        case 'INVESTMENT':
          return (
            (
              await client.companyInvestment.findUnique({
                where: { id },
                select: { companyId: true },
              })
            )?.companyId ?? undefined
          );
      }
    }
    if (params.branchId) {
      return (
        await client.branch.findUnique({
          where: { id: params.branchId },
          select: { companyId: true },
        })
      )?.companyId;
    }
    return undefined;
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

    const companyId = await this.resolveCompanyId(params, client);
    if (!companyId) {
      throw new BadRequestException(
        `Cannot determine which company's books ${params.sourceModule}${params.sourceId ? `:${params.sourceId}` : ''} belongs to; refusing to post an entry that would belong to no one`,
      );
    }

    const entry = await client.journalEntry.create({
      data: {
        companyId,
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
    tenant?: string,
  ) {
    const original = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { debitAccount: true, creditAccount: true },
    });
    // Another company's entry is indistinguishable from a missing one.
    if (!original || (tenant !== undefined && original.companyId !== tenant)) {
      throw new NotFoundException('Journal entry not found');
    }
    if (original.status === JournalEntryStatus.REVERSED) {
      throw new BadRequestException('This journal entry was already reversed');
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      // Atomic POSTED -> REVERSED: two simultaneous reversals cannot both succeed (the unique
      // reversalOfId would only have rejected the second *after* it had done its work).
      const claim = await tx.journalEntry.updateMany({
        where: { id: original.id, status: JournalEntryStatus.POSTED },
        data: { status: JournalEntryStatus.REVERSED },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          'This journal entry was already reversed',
        );
      }
      const created = await tx.journalEntry.create({
        data: {
          companyId: original.companyId,
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
  async getAccountBalance(
    code: string,
    asOf?: Date,
    companyId?: string,
  ): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code },
    });
    if (!account) return 0;

    const dateFilter = {
      ...(asOf ? { createdAt: { lte: asOf } } : {}),
      ...(companyId !== undefined ? { companyId } : {}),
    };
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
    companyId?: string,
  ): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code },
    });
    if (!account) return 0;

    const dateFilter = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    const createdAt = {
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      ...(companyId !== undefined ? { companyId } : {}),
    };

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
  async trialBalance(asOf?: Date, companyId?: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return Promise.all(
      accounts.map(async (account) => ({
        code: account.code,
        name: account.name,
        type: account.type,
        balance: await this.getAccountBalance(account.code, asOf, companyId),
      })),
    );
  }

  listEntries(
    filters: {
      sourceModule?: string;
      sourceId?: string;
      accountCode?: string;
      from?: Date;
      to?: Date;
    },
    companyId?: string,
  ) {
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
        ...(companyId !== undefined ? { companyId } : {}),
        ...dateFilter,
      },
      include: { debitAccount: true, creditAccount: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
