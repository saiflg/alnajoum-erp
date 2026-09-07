import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateApprovalThresholdRuleDto } from './dto/create-approval-threshold-rule.dto';
import { UpdateApprovalThresholdRuleDto } from './dto/update-approval-threshold-rule.dto';

/**
 * Spec #10 — "do not hard-code these exact amounts, make them
 * configurable." CRUD for the ApprovalThresholdRule rows
 * ApprovalsService.resolveRequiredApprovals reads.
 */
@Injectable()
export class ApprovalThresholdRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantCompanyId?: string) {
    return this.prisma.approvalThresholdRule.findMany({
      where: {
        ...(tenantCompanyId !== undefined && {
          OR: [{ companyId: tenantCompanyId }, { companyId: null }],
        }),
      },
      orderBy: [{ type: 'asc' }, { minAmount: 'asc' }],
    });
  }

  create(dto: CreateApprovalThresholdRuleDto, companyId?: string) {
    return this.prisma.approvalThresholdRule.create({
      data: { ...dto, companyId },
    });
  }

  private async get(id: string) {
    const rule = await this.prisma.approvalThresholdRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Approval threshold rule not found');
    return rule;
  }

  async update(id: string, dto: UpdateApprovalThresholdRuleDto) {
    await this.get(id);
    return this.prisma.approvalThresholdRule.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.get(id);
    await this.prisma.approvalThresholdRule.delete({ where: { id } });
  }
}
