import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankStatementLineStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBankStatementLineDto } from './dto/create-bank-statement-line.dto';
import { MatchBankStatementLineDto } from './dto/match-bank-statement-line.dto';

import { tenantWhere } from '../../common/tenancy/tenant-guard.service';
/**
 * Spec #23. Localhost has no live bank-feed integration, so lines are
 * entered manually (one at a time, or pasted in bulk from a CSV export —
 * see importBulk) rather than pulled automatically; matching/ignoring is
 * always a deliberate Finance action.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async addLine(dto: CreateBankStatementLineDto, importedByStaffId: string) {
    return this.prisma.bankStatementLine.create({
      data: {
        date: new Date(dto.date),
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        externalReference: dto.externalReference,
        importedByStaffId,
      },
    });
  }

  async importBulk(
    lines: CreateBankStatementLineDto[],
    importedByStaffId: string,
  ) {
    const created = await this.prisma.$transaction(
      lines.map((dto) =>
        this.prisma.bankStatementLine.create({
          data: {
            date: new Date(dto.date),
            description: dto.description,
            amount: dto.amount,
            currency: dto.currency ?? 'NGN',
            externalReference: dto.externalReference,
            importedByStaffId,
          },
        }),
      ),
    );
    return { imported: created.length };
  }

  /** A statement line belongs to the company of the staff member who imported it. */
  private lineScope(tenant?: string) {
    return tenant === undefined
      ? {}
      : { importedByStaff: { companyId: tenant } };
  }

  /** The record a line is being matched to must exist and, for a tenant, be that company's own. */
  private async assertMatchTarget(
    type: MatchBankStatementLineDto['matchedType'],
    id: string,
    tenant?: string,
  ) {
    const t = tenant;
    const found =
      type === 'PAYMENT'
        ? await this.prisma.payment.findFirst({
            where: {
              id,
              ...(t !== undefined && { invoice: tenantWhere('invoice', t) }),
            },
            select: { id: true },
          })
        : type === 'EXPENSE'
          ? await this.prisma.expense.findFirst({
              where: {
                id,
                ...(t !== undefined && { createdByStaff: { companyId: t } }),
              },
              select: { id: true },
            })
          : type === 'SUPPLIER_PAYMENT'
            ? await this.prisma.supplierPayment.findFirst({
                where: {
                  id,
                  ...(t !== undefined && { payable: { companyId: t } }),
                },
                select: { id: true },
              })
            : await this.prisma.staffPayout.findFirst({
                where: {
                  id,
                  ...(t !== undefined && { staff: { companyId: t } }),
                },
                select: { id: true },
              });
    if (!found)
      throw new NotFoundException('The record to match was not found');
  }

  listAll(filters: { status?: BankStatementLineStatus }, tenant?: string) {
    return this.prisma.bankStatementLine.findMany({
      where: { ...filters, ...this.lineScope(tenant) },
      take: 1000,
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Flags likely duplicates (spec #23's "identify duplicate payments") —
   * same amount, currency, and externalReference appearing on more than
   * one UNMATCHED line.
   */
  async findDuplicates(tenant?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        status: BankStatementLineStatus.UNMATCHED,
        externalReference: { not: null },
        ...this.lineScope(tenant),
      },
    });
    const seen = new Map<string, typeof lines>();
    for (const line of lines) {
      const key = `${line.externalReference}|${line.amount}|${line.currency}`;
      seen.set(key, [...(seen.get(key) ?? []), line]);
    }
    return [...seen.values()].filter((group) => group.length > 1).flat();
  }

  async match(
    id: string,
    dto: MatchBankStatementLineDto,
    actorIdentityId?: string,
    tenant?: string,
  ) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, ...this.lineScope(tenant) },
    });
    if (!line) {
      throw new NotFoundException('Bank statement line not found');
    }
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new ConflictException('This line has already been reconciled');
    }
    await this.assertMatchTarget(dto.matchedType, dto.matchedId, tenant);

    // Atomic UNMATCHED -> MATCHED: two reconcilers cannot both claim the same line.
    const claim = await this.prisma.bankStatementLine.updateMany({
      where: { id, status: BankStatementLineStatus.UNMATCHED },
      data: {
        status: BankStatementLineStatus.MATCHED,
        matchedType: dto.matchedType,
        matchedId: dto.matchedId,
      },
    });
    if (claim.count === 0) {
      throw new ConflictException('This line has already been reconciled');
    }
    const updated = await this.prisma.bankStatementLine.findUniqueOrThrow({
      where: { id },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'bank_reconciliation.matched',
      entityType: 'BankStatementLine',
      entityId: id,
      metadata: { matchedType: dto.matchedType, matchedId: dto.matchedId },
    });

    return updated;
  }

  async ignore(id: string, actorIdentityId?: string, tenant?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, ...this.lineScope(tenant) },
    });
    if (!line) {
      throw new NotFoundException('Bank statement line not found');
    }
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new ConflictException('This line has already been reconciled');
    }
    const updated = await this.prisma.bankStatementLine.update({
      where: { id },
      data: { status: BankStatementLineStatus.IGNORED },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'bank_reconciliation.ignored',
      entityType: 'BankStatementLine',
      entityId: id,
    });
    return updated;
  }
}
