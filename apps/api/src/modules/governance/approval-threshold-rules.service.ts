import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  /**
   * A tenant admin may change only their own company's rules. The platform-wide defaults
   * (companyId null) apply to every tenant, so only a SUPER_ADMIN (`tenant` undefined) may touch them;
   * to a tenant they are visible but read-only, and another company's rule does not exist.
   */
  private async get(id: string, tenant?: string) {
    const rule = await this.prisma.approvalThresholdRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Approval threshold rule not found');
    if (tenant !== undefined) {
      if (rule.companyId === null) {
        throw new ForbiddenException(
          'Platform-wide approval rules can only be changed by a Super Admin.',
        );
      }
      if (rule.companyId !== tenant) {
        throw new NotFoundException('Approval threshold rule not found');
      }
    }
    return rule;
  }

  async update(
    id: string,
    dto: UpdateApprovalThresholdRuleDto,
    tenant?: string,
  ) {
    await this.get(id, tenant);
    return this.prisma.approvalThresholdRule.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string, tenant?: string) {
    await this.get(id, tenant);
    await this.prisma.approvalThresholdRule.delete({ where: { id } });
  }
}
