import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCountryVisaRuleDto } from './dto/create-country-visa-rule.dto';
import { UpdateCountryVisaRuleDto } from './dto/update-country-visa-rule.dto';

/**
 * Spec #4 — configurable country/visa-type requirements. Never a hard-coded
 * per-country rule anywhere else in the codebase: VisaChecklistService and
 * VisaSlaService both read through getApplicableRule() below, the single
 * place "which rule applies" is decided.
 */
@Injectable()
export class CountryVisaRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateCountryVisaRuleDto, actorIdentityId?: string) {
    const visaType = dto.visaType ?? '';
    const existing = await this.prisma.countryVisaRule.findUnique({
      where: { country_visaType: { country: dto.country, visaType } },
    });
    if (existing) {
      throw new ConflictException(
        visaType
          ? `A rule for ${dto.country} / ${visaType} already exists`
          : `A default rule for ${dto.country} already exists`,
      );
    }

    const rule = await this.prisma.countryVisaRule.create({
      data: { ...dto, visaType },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'country_visa_rule.created',
      entityType: 'CountryVisaRule',
      entityId: rule.id,
      metadata: { country: rule.country, visaType: rule.visaType },
    });
    return rule;
  }

  listAll(filters: { country?: string; isActive?: boolean }) {
    return this.prisma.countryVisaRule.findMany({
      where: filters,
      orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
    });
  }

  async get(id: string) {
    const rule = await this.prisma.countryVisaRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Country visa rule not found');
    return rule;
  }

  async update(
    id: string,
    dto: UpdateCountryVisaRuleDto,
    actorIdentityId?: string,
  ) {
    await this.get(id);
    const rule = await this.prisma.countryVisaRule.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'country_visa_rule.updated',
      entityType: 'CountryVisaRule',
      entityId: id,
    });
    return rule;
  }

  async deactivate(id: string, actorIdentityId?: string) {
    await this.get(id);
    const rule = await this.prisma.countryVisaRule.update({
      where: { id },
      data: { isActive: false },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'country_visa_rule.deactivated',
      entityType: 'CountryVisaRule',
      entityId: id,
    });
    return rule;
  }

  /**
   * The exact (country, visaType) rule if one exists and is active,
   * otherwise that country's (country, "") default rule, otherwise null —
   * callers (checklist/passport-validity/SLA) must all treat null as
   * "nothing configured yet", never assume a universal fallback.
   */
  async getApplicableRule(country: string, visaType: string | null) {
    if (visaType) {
      const specific = await this.prisma.countryVisaRule.findUnique({
        where: { country_visaType: { country, visaType } },
      });
      if (specific?.isActive) return specific;
    }
    const generic = await this.prisma.countryVisaRule.findUnique({
      where: { country_visaType: { country, visaType: '' } },
    });
    return generic?.isActive ? generic : null;
  }
}
