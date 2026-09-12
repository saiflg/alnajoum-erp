import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';

/**
 * Phase 11 spec #22 — configurable tax rules (VAT, departure levies, ...).
 * CRUD/lookup only in this phase, same scope as the schema's own doc
 * comment on TaxRule: not wired into any module's pricing engine yet
 * (FlightPricingRule/FlightServiceFee keep working exactly as before). A
 * future phase can have those engines resolve a matching TaxRule the same
 * way they resolve a FlightServiceFee today.
 *
 * Platform-wide, not tenant-scoped — same reasoning as CurrencyService: a
 * government's tax rate is a fact about the world every tenant shares,
 * not private business data. applicableService/country are how a rule
 * narrows itself, not a tenant boundary.
 */
@Injectable()
export class TaxRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listAll(filters: {
    applicableService?: string;
    country?: string;
    isActive?: boolean;
  }) {
    return this.prisma.taxRule.findMany({
      where: {
        applicableService: filters.applicableService,
        country: filters.country,
        isActive: filters.isActive,
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const rule = await this.prisma.taxRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Tax rule not found');
    return rule;
  }

  async create(dto: CreateTaxRuleDto, actorIdentityId?: string) {
    const rule = await this.prisma.taxRule.create({
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom
          ? new Date(dto.effectiveFrom)
          : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'tax_rule.created',
      entityType: 'TaxRule',
      entityId: rule.id,
      metadata: { name: rule.name },
    });

    return rule;
  }

  async update(id: string, dto: UpdateTaxRuleDto, actorIdentityId?: string) {
    await this.get(id);

    const updated = await this.prisma.taxRule.update({
      where: { id },
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom
          ? new Date(dto.effectiveFrom)
          : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'tax_rule.updated',
      entityType: 'TaxRule',
      entityId: id,
      metadata: { changes: { ...dto } },
    });

    return updated;
  }
}
