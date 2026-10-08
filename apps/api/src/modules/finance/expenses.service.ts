import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ACCOUNT_CODES } from './constants/account-codes.constant';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { FinancePostingService } from './finance-posting.service';

function generateExpenseNumber(): string {
  return `EXP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Spec #19. Recording is PENDING with zero ledger effect (same "submit vs approve" split as ManualPaymentSubmission) — only markPaid() posts a journal entry. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly financePostingService: FinancePostingService,
  ) {}

  async create(
    dto: CreateExpenseDto,
    createdByStaffId: string,
    actorIdentityId?: string,
  ) {
    const expense = await this.prisma.expense.create({
      data: {
        expenseNumber: generateExpenseNumber(),
        category: dto.category,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        date: new Date(dto.date),
        description: dto.description,
        vendor: dto.vendor,
        paymentMethod: dto.paymentMethod,
        branchId: dto.branchId,
        accountId: dto.accountId,
        createdByStaffId,
        status: ExpenseStatus.PENDING,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'expense.created',
      entityType: 'Expense',
      entityId: expense.id,
      metadata: { amount: dto.amount, category: dto.category },
    });

    return expense;
  }

  attachReceipt(id: string, storedFileName: string) {
    return this.prisma.expense.update({
      where: { id },
      data: { receiptDocumentPath: storedFileName },
    });
  }

  listAll(
    filters: {
      status?: ExpenseStatus;
      branchId?: string;
      category?: string;
    },
    tenant?: string,
  ) {
    return this.prisma.expense.findMany({
      // An expense belongs to the company of the staff member who submitted it.
      where: {
        ...filters,
        ...(tenant !== undefined && {
          createdByStaff: { companyId: tenant },
        }),
      },
      take: 500,
      include: {
        createdByStaff: { select: { firstName: true, lastName: true } },
        approvedByStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
        account: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: { branch: true, account: true },
    });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }

  /** Approving just authorizes it for payment — still no ledger effect until markPaid(). */
  async approve(
    id: string,
    approvedByStaffId: string,
    actorIdentityId?: string,
  ) {
    const expense = await this.get(id);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new ConflictException(
        `This expense is already ${expense.status.toLowerCase()}`,
      );
    }
    // Segregation of duties: whoever submitted a spend cannot be the one who authorises it.
    if (expense.createdByStaffId === approvedByStaffId) {
      throw new ForbiddenException(
        'You cannot approve an expense that you submitted yourself',
      );
    }
    // Atomic PENDING -> APPROVED: two reviewers cannot both decide the same expense.
    const claim = await this.prisma.expense.updateMany({
      where: { id, status: ExpenseStatus.PENDING },
      data: {
        status: ExpenseStatus.APPROVED,
        approvedByStaffId,
        approvedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new ConflictException('This expense has already been reviewed');
    }
    const updated = await this.prisma.expense.findUniqueOrThrow({
      where: { id },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'expense.approved',
      entityType: 'Expense',
      entityId: id,
      metadata: { approvedByStaffId },
    });
    return updated;
  }

  async reject(id: string, reason: string, actorIdentityId?: string) {
    const expense = await this.get(id);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new ConflictException(
        `This expense is already ${expense.status.toLowerCase()}`,
      );
    }
    const claim = await this.prisma.expense.updateMany({
      where: { id, status: ExpenseStatus.PENDING },
      data: { status: ExpenseStatus.REJECTED, rejectionReason: reason },
    });
    if (claim.count === 0) {
      throw new ConflictException('This expense has already been reviewed');
    }
    const updated = await this.prisma.expense.findUniqueOrThrow({
      where: { id },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'expense.rejected',
      entityType: 'Expense',
      entityId: id,
      metadata: { reason },
    });
    return updated;
  }

  /** The one action that actually moves money — posts the ledger entry and flips PAID. */
  async markPaid(id: string, actorIdentityId?: string) {
    const expense = await this.get(id);
    if (expense.status !== ExpenseStatus.APPROVED) {
      throw new ConflictException(
        'Only an approved expense can be marked paid',
      );
    }

    const accountCode =
      expense.account?.code ?? this.fallbackAccountCode(expense.category);

    // Atomic APPROVED -> PAID *before* the money moves: a double click or a retry can no longer post
    // the expense to the ledger twice.
    const claim = await this.prisma.expense.updateMany({
      where: { id, status: ExpenseStatus.APPROVED },
      data: { status: ExpenseStatus.PAID, paidAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException('This expense has already been paid');
    }
    const updated = await this.prisma.expense.findUniqueOrThrow({
      where: { id },
    });

    try {
      await this.financePostingService.postExpensePaid(updated, accountCode);
    } catch (error) {
      // The ledger entry did not happen, so the expense must not read as paid.
      await this.prisma.expense.updateMany({
        where: { id, status: ExpenseStatus.PAID },
        data: { status: ExpenseStatus.APPROVED, paidAt: null },
      });
      throw error;
    }

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'expense.paid',
      entityType: 'Expense',
      entityId: id,
      metadata: { amount: expense.amount },
    });

    return updated;
  }

  /** Falls back to a sensible expense account when the submitter didn't pick one from the chart of accounts. */
  private fallbackAccountCode(category: string): string {
    const normalized = category.trim().toLowerCase();
    if (normalized.includes('staff')) return ACCOUNT_CODES.STAFF_EXPENSES;
    if (normalized.includes('market')) return ACCOUNT_CODES.MARKETING;
    if (normalized.includes('host')) return ACCOUNT_CODES.HOSTING;
    if (normalized.includes('api')) return ACCOUNT_CODES.API_COSTS;
    if (normalized.includes('bank')) return ACCOUNT_CODES.BANK_CHARGES;
    if (normalized.includes('office')) return ACCOUNT_CODES.OFFICE_EXPENSES;
    return ACCOUNT_CODES.OTHER_EXPENSES;
  }
}
