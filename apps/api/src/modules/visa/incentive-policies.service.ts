import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateIncentivePolicyDto } from './dto/create-incentive-policy.dto';
import { UpdateIncentivePolicyDto } from './dto/update-incentive-policy.dto';

@Injectable()
export class IncentivePoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateIncentivePolicyDto, actorIdentityId?: string) {
    // At most one default policy platform-wide — unsetting any existing
    // default mirrors IntegrationsService.setActive's "only one active per
    // category" transaction pattern.
    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.incentivePolicy.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.incentivePolicy.create({ data: dto });
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'incentive_policy.created',
      entityType: 'IncentivePolicy',
      entityId: created.id,
      metadata: { type: created.type, config: created.config },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateIncentivePolicyDto,
    actorIdentityId?: string,
  ) {
    await this.get(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.incentivePolicy.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.incentivePolicy.update({ where: { id }, data: dto });
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'incentive_policy.updated',
      entityType: 'IncentivePolicy',
      entityId: id,
    });
    return updated;
  }

  list() {
    return this.prisma.incentivePolicy.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const policy = await this.prisma.incentivePolicy.findUnique({
      where: { id },
    });
    if (!policy) {
      throw new NotFoundException('Incentive policy not found');
    }
    return policy;
  }
}
