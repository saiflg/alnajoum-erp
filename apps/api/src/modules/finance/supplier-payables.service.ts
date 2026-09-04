import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupplierPayableStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ACCOUNT_CODES } from './constants/account-codes.constant';
import { LedgerService } from './ledger.service';
import { RecordSupplierPaymentDto } from './dto/record-supplier-payment.dto';

/**
 * Spec #20. Rows are created automatically by FinancePostingService.
 * postCostOfServiceForBooking() the moment a flight is ticketed / hotel
 * booking completed / visa cost confirmed — this service is where Finance
 * actually pays the supplier down against that obligation.
 */
@Injectable()
export class SupplierPayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  listAll(filters: { status?: SupplierPayableStatus; supplierName?: string }) {
    return this.prisma.supplierPayable.findMany({
      where: {
        status: filters.status,
        supplierName: filters.supplierName
          ? { contains: filters.supplierName, mode: 'insensitive' }
          : undefined,
      },
      include: { payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const payable = await this.prisma.supplierPayable.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!payable) {
      throw new NotFoundException('Supplier payable not found');
    }
    return payable;
  }

  async recordPayment(
    payableId: string,
    dto: RecordSupplierPaymentDto,
    recordedByStaffId: string,
    actorIdentityId?: string,
  ) {
    const payable = await this.get(payableId);
    const outstanding = payable.amount - payable.amountPaid;
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds the outstanding balance (${outstanding})`,
      );
    }

    const [payment] = await this.prisma.$transaction([
      this.prisma.supplierPayment.create({
        data: {
          payableId,
          amount: dto.amount,
          currency: payable.currency,
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          note: dto.note,
          recordedByStaffId,
        },
      }),
      this.prisma.supplierPayable.update({
        where: { id: payableId },
        data: {
          amountPaid: payable.amountPaid + dto.amount,
          status:
            payable.amountPaid + dto.amount >= payable.amount
              ? SupplierPayableStatus.PAID
              : SupplierPayableStatus.PARTIALLY_PAID,
        },
      }),
    ]);

    await this.ledger.post({
      debitCode: ACCOUNT_CODES.SUPPLIER_PAYABLES,
      creditCode:
        dto.paymentMethod === 'CASH'
          ? ACCOUNT_CODES.CASH
          : ACCOUNT_CODES.BANK_ACCOUNTS,
      amount: dto.amount,
      currency: payable.currency,
      reference: dto.reference ?? payment.id,
      description: `Supplier payment to ${payable.supplierName}`,
      sourceModule: 'SUPPLIER_PAYMENT',
      sourceId: payment.id,
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier_payment.recorded',
      entityType: 'SupplierPayable',
      entityId: payableId,
      metadata: { amount: dto.amount, recordedByStaffId },
    });

    return this.get(payableId);
  }

  /** A cron-free "run this occasionally" sweep — flips OUTSTANDING/PARTIALLY_PAID rows past their dueDate to OVERDUE. Called from the reports controller on read rather than on a schedule, since this codebase has no background job runner yet. */
  async markOverdue() {
    const now = new Date();
    await this.prisma.supplierPayable.updateMany({
      where: {
        dueDate: { lt: now },
        status: {
          in: [
            SupplierPayableStatus.OUTSTANDING,
            SupplierPayableStatus.PARTIALLY_PAID,
          ],
        },
      },
      data: { status: SupplierPayableStatus.OVERDUE },
    });
  }
}
