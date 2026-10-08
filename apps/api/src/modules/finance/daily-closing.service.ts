import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { tenantWhere } from '../../common/tenancy/tenant-guard.service';
import { AuditService } from '../audit/audit.service';
import { ACCOUNT_CODES } from './constants/account-codes.constant';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Spec #22. `summary` is computed fresh and frozen at close time — see DailyClosing's doc comment in schema.prisma. */
@Injectable()
export class DailyClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async isDateClosed(
    date: Date,
    branchId?: string,
    companyId?: string,
  ): Promise<boolean> {
    const closing = await this.prisma.dailyClosing.findFirst({
      where: {
        businessDate: startOfDay(date),
        branchId: branchId ?? null,
        ...(companyId !== undefined && { companyId }),
      },
    });
    return closing != null;
  }

  /** `tenant` undefined = SUPER_ADMIN (the whole platform); otherwise only that company's movements. */
  async preview(businessDate: Date, tenant?: string) {
    const from = startOfDay(businessDate);
    const to = endOfDay(businessDate);

    const payments = await this.prisma.payment.findMany({
      where: {
        paidAt: { gte: from, lte: to },
        ...(tenant !== undefined && {
          invoice: tenantWhere('invoice', tenant),
        }),
      },
    });
    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    }

    const refundLossesAccount = await this.prisma.ledgerAccount.findUnique({
      where: { code: ACCOUNT_CODES.REFUND_LOSSES },
    });

    const [walletTransactions, refunds, expenses, payouts, supplierPayments] =
      await Promise.all([
        this.prisma.walletTransaction.aggregate({
          where: {
            createdAt: { gte: from, lte: to },
            ...(tenant !== undefined && {
              wallet: { customer: { companyId: tenant } },
            }),
          },
          _sum: { amount: true },
        }),
        refundLossesAccount
          ? this.prisma.journalEntry.aggregate({
              where: {
                debitAccountId: refundLossesAccount.id,
                createdAt: { gte: from, lte: to },
                ...(tenant !== undefined && { companyId: tenant }),
              },
              _sum: { amount: true },
            })
          : Promise.resolve({ _sum: { amount: 0 } }),
        this.prisma.expense.aggregate({
          where: {
            paidAt: { gte: from, lte: to },
            ...(tenant !== undefined && {
              createdByStaff: { companyId: tenant },
            }),
          },
          _sum: { amount: true },
        }),
        this.prisma.staffPayout.aggregate({
          where: {
            status: 'SUCCESSFUL',
            updatedAt: { gte: from, lte: to },
            ...(tenant !== undefined && { staff: { companyId: tenant } }),
          },
          _sum: { amount: true },
        }),
        this.prisma.supplierPayment.aggregate({
          where: {
            paidAt: { gte: from, lte: to },
            ...(tenant !== undefined && { payable: { companyId: tenant } }),
          },
          _sum: { amount: true },
        }),
      ]);

    return {
      businessDate: from,
      cash: byMethod[PaymentMethod.CASH] ?? 0,
      bankTransfer: byMethod[PaymentMethod.BANK_TRANSFER] ?? 0,
      pos: byMethod[PaymentMethod.POS] ?? 0,
      card: byMethod[PaymentMethod.CARD] ?? 0,
      online: byMethod[PaymentMethod.ONLINE] ?? 0,
      wallet: byMethod[PaymentMethod.WALLET] ?? 0,
      totalPayments: payments.reduce((sum, p) => sum + p.amount, 0),
      walletMovement: walletTransactions._sum.amount ?? 0,
      refunds: refunds._sum.amount ?? 0,
      expensesPaid: expenses._sum.amount ?? 0,
      staffPayouts: payouts._sum.amount ?? 0,
      supplierPayments: supplierPayments._sum.amount ?? 0,
    };
  }

  async close(
    businessDate: Date,
    closedByStaffId: string,
    branchId: string | undefined,
    actorIdentityId: string | undefined,
    companyId: string,
  ) {
    const day = startOfDay(businessDate);
    // A day is closed per company: another company having closed the same date is irrelevant.
    if (await this.isDateClosed(day, branchId, companyId)) {
      throw new ConflictException('This business date has already been closed');
    }

    // The frozen summary covers THIS company's movements only.
    const summary = await this.preview(day, companyId);
    const closing = await this.prisma.dailyClosing.create({
      data: {
        companyId,
        businessDate: day,
        branchId,
        summary,
        closedByStaffId,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'daily_closing.closed',
      entityType: 'DailyClosing',
      entityId: closing.id,
      metadata: { businessDate: day.toISOString(), branchId, summary },
    });

    return closing;
  }

  listAll(filters: { branchId?: string }, tenant?: string) {
    return this.prisma.dailyClosing.findMany({
      where: { ...filters, ...(tenant !== undefined && { companyId: tenant }) },
      take: 500,
      include: {
        closedByStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { businessDate: 'desc' },
    });
  }
}
