import { Injectable } from '@nestjs/common';
import { InvestmentType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { FinancePostingService } from './finance-posting.service';

/** Spec #15/#16 — equity, never revenue; always Super Admin / Company Admin only (see FINANCE.INVESTMENT_MANAGE). */
@Injectable()
export class CompanyInvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly financePostingService: FinancePostingService,
  ) {}

  async create(dto: CreateInvestmentDto, actorIdentityId?: string) {
    const investment = await this.prisma.companyInvestment.create({
      data: {
        type: dto.type,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        investor: dto.investor,
        date: new Date(dto.date),
        description: dto.description,
        reference: dto.reference,
        recordedByIdentityId: actorIdentityId,
      },
    });

    await this.financePostingService.postInvestment(investment);

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'investment.recorded',
      entityType: 'CompanyInvestment',
      entityId: investment.id,
      metadata: { type: dto.type, amount: dto.amount, investor: dto.investor },
    });

    return investment;
  }

  listAll(filters: { type?: InvestmentType }) {
    return this.prisma.companyInvestment.findMany({
      where: filters,
      orderBy: { date: 'desc' },
    });
  }

  /** Spec #16's "Initial + Additional − Withdrawals" position, kept distinct from operating profit. */
  async position() {
    const investments = await this.prisma.companyInvestment.findMany();
    const initial = investments
      .filter((i) => i.type === InvestmentType.INITIAL)
      .reduce((sum, i) => sum + i.amount, 0);
    const additional = investments
      .filter((i) => i.type === InvestmentType.ADDITIONAL)
      .reduce((sum, i) => sum + i.amount, 0);
    const withdrawals = investments
      .filter((i) => i.type === InvestmentType.WITHDRAWAL)
      .reduce((sum, i) => sum + i.amount, 0);
    return {
      initial,
      additional,
      withdrawals,
      totalInvested: initial + additional - withdrawals,
    };
  }
}
