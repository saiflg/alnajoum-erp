import { toJsonValue } from '../../common/utils/json.util';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingEngineError } from './engine/pricing-engine';
import {
  validateAction,
  validateConditions,
  validateTier,
} from './engine/rule-validation';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';

function asBadRequest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PricingEngineError)
      throw new BadRequestException(error.message);
    throw error;
  }
}

/**
 * Pricing rules are commercial configuration, so they are never edited in
 * place: every change appends an immutable PricingRuleVersion and bumps the
 * rule's `currentVersion`. A booking snapshot names the version that priced
 * it, so a later edit can never rewrite history.
 *
 * Tenancy: a tenant manages only its own rules (companyId = theirs). A rule
 * with companyId null is a platform default and only the super admin may touch
 * it. Reading another tenant's rule is NotFound, never Forbidden, so a rule id
 * can't be used to probe other tenants.
 */
@Injectable()
export class PricingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** What a caller may see: their tenant's rules plus the platform defaults (cost-bearing detail stays behind the permission). */
  list(
    tenantCompanyId: string | undefined,
    filters: { isActive?: boolean } = {},
  ) {
    return this.prisma.pricingRule.findMany({
      where: {
        ...(tenantCompanyId !== undefined && {
          OR: [{ companyId: tenantCompanyId }, { companyId: null }],
        }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      },
      orderBy: [{ tier: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string, tenantCompanyId: string | undefined) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (
      !rule ||
      (tenantCompanyId !== undefined &&
        rule.companyId !== null &&
        rule.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Pricing rule not found');
    }
    return rule;
  }

  async versions(id: string, tenantCompanyId: string | undefined) {
    await this.get(id, tenantCompanyId);
    return this.prisma.pricingRuleVersion.findMany({
      where: { ruleId: id },
      orderBy: { version: 'desc' },
    });
  }

  /** `owningCompanyId` is the tenant the new rule belongs to; null (super admin only) makes it a platform default. */
  async create(
    dto: CreatePricingRuleDto,
    owningCompanyId: string | null,
    actorIdentityId: string,
  ) {
    const conditions = asBadRequest(() => validateConditions(dto.conditions));
    const action = asBadRequest(() => validateAction(dto.action));
    asBadRequest(() => validateTier(dto.tier));
    if (
      dto.effectiveFrom &&
      dto.effectiveTo &&
      dto.effectiveFrom > dto.effectiveTo
    ) {
      throw new BadRequestException(
        'effectiveFrom must be on or before effectiveTo',
      );
    }

    const snapshot = {
      name: dto.name,
      tier: dto.tier,
      priority: dto.priority ?? 0,
      isActive: dto.isActive ?? true,
      effectiveFrom: dto.effectiveFrom ?? null,
      effectiveTo: dto.effectiveTo ?? null,
      conditions,
      action,
    };

    const rule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pricingRule.create({
        data: {
          companyId: owningCompanyId,
          name: snapshot.name,
          tier: snapshot.tier,
          priority: snapshot.priority,
          isActive: snapshot.isActive,
          effectiveFrom: snapshot.effectiveFrom,
          effectiveTo: snapshot.effectiveTo,
          conditions: conditions as unknown as Prisma.InputJsonValue,
          action: action as unknown as Prisma.InputJsonValue,
          currentVersion: 1,
          createdByIdentityId: actorIdentityId,
        },
      });
      await tx.pricingRuleVersion.create({
        data: {
          ruleId: created.id,
          version: 1,
          snapshot: toJsonValue(snapshot),
          changeReason: 'Created',
          changedByIdentityId: actorIdentityId,
        },
      });
      return created;
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'revenue.rule_created',
      entityType: 'PricingRule',
      entityId: rule.id,
      companyId: owningCompanyId ?? undefined,
      newValue: toJsonValue(snapshot),
    });
    return rule;
  }

  async update(
    id: string,
    dto: UpdatePricingRuleDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    // A tenant admin can read the platform defaults but never change them.
    if (existing.companyId === null && tenantCompanyId !== undefined) {
      throw new ForbiddenException(
        'Platform default pricing rules can only be changed by a platform administrator',
      );
    }
    if (
      dto.expectedVersion !== undefined &&
      dto.expectedVersion !== existing.currentVersion
    ) {
      throw new ConflictException(
        `This rule was changed by someone else (now version ${existing.currentVersion}). Reload and try again.`,
      );
    }

    const next = {
      name: dto.name ?? existing.name,
      tier: dto.tier ?? existing.tier,
      priority: dto.priority ?? existing.priority,
      isActive: dto.isActive ?? existing.isActive,
      effectiveFrom: dto.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? existing.effectiveTo,
      conditions:
        dto.conditions !== undefined
          ? asBadRequest(() => validateConditions(dto.conditions))
          : existing.conditions,
      action:
        dto.action !== undefined
          ? asBadRequest(() => validateAction(dto.action))
          : existing.action,
    };
    asBadRequest(() => validateTier(next.tier));
    if (
      next.effectiveFrom &&
      next.effectiveTo &&
      next.effectiveFrom > next.effectiveTo
    ) {
      throw new BadRequestException(
        'effectiveFrom must be on or before effectiveTo',
      );
    }

    const newVersion = existing.currentVersion + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      // The conditional write is the optimistic lock: it only succeeds while the rule is still at the version we read.
      const claim = await tx.pricingRule.updateMany({
        where: { id, currentVersion: existing.currentVersion },
        data: {
          name: next.name,
          tier: next.tier,
          priority: next.priority,
          isActive: next.isActive,
          effectiveFrom: next.effectiveFrom,
          effectiveTo: next.effectiveTo,
          conditions: next.conditions as unknown as Prisma.InputJsonValue,
          action: next.action as unknown as Prisma.InputJsonValue,
          currentVersion: newVersion,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException(
          'This rule was changed by someone else. Reload and try again.',
        );
      }
      await tx.pricingRuleVersion.create({
        data: {
          ruleId: id,
          version: newVersion,
          snapshot: toJsonValue(next),
          changeReason: dto.reason,
          changedByIdentityId: actorIdentityId,
        },
      });
      return tx.pricingRule.findUniqueOrThrow({ where: { id } });
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'revenue.rule_updated',
      entityType: 'PricingRule',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      reason: dto.reason,
      previousValue: toJsonValue({
        version: existing.currentVersion,
        ...existing,
      }),
      newValue: toJsonValue({ version: newVersion, ...next }),
    });
    return updated;
  }
}
