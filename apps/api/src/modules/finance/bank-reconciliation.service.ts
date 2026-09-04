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

  listAll(filters: { status?: BankStatementLineStatus }) {
    return this.prisma.bankStatementLine.findMany({
      where: filters,
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Flags likely duplicates (spec #23's "identify duplicate payments") —
   * same amount, currency, and externalReference appearing on more than
   * one UNMATCHED line.
   */
  async findDuplicates() {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        status: BankStatementLineStatus.UNMATCHED,
        externalReference: { not: null },
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
  ) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id },
    });
    if (!line) {
      throw new NotFoundException('Bank statement line not found');
    }
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new ConflictException('This line has already been reconciled');
    }

    const updated = await this.prisma.bankStatementLine.update({
      where: { id },
      data: {
        status: BankStatementLineStatus.MATCHED,
        matchedType: dto.matchedType,
        matchedId: dto.matchedId,
      },
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

  async ignore(id: string, actorIdentityId?: string) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id },
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
