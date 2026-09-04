import { Injectable } from '@nestjs/common';
import { CabinClass, FlightPricingRule } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightPricingRuleDto } from './dto/create-flight-pricing-rule.dto';
import { UpdateFlightPricingRuleDto } from './dto/update-flight-pricing-rule.dto';

export interface PricingContext {
  airlineCode?: string;
  origin: string;
  destination: string;
  cabinClass: CabinClass;
  staffId?: string;
  branchId?: string;
}

export interface PricingResult {
  customerPrice: number;
  markupAmount: number;
  rule: FlightPricingRule | null;
}

/**
 * Configurable agency markup (spec #18) — never a hard-coded percentage in
 * code. Resolves the most specific active rule matching a booking's
 * airline/route/cabin/staff/branch, applies FIXED or PERCENTAGE markup on
 * top of the provider's price, and falls back to zero markup only when no
 * rule matches at all (the demo seed always keeps one global-default rule
 * active so that never happens by accident in a real deployment).
 */
@Injectable()
export class FlightPricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every non-null scope field on a rule must match the context; a rule
   * with every scope field left blank matches everything (the natural home
   * for a "global default" markup). Among every matching active rule, the
   * highest `priority` wins — ties broken by whichever rule has the most
   * non-null scope fields set, so a more specific rule still edges out an
   * equal-priority broader one.
   */
  async resolveRule(
    context: PricingContext,
  ): Promise<FlightPricingRule | null> {
    const now = new Date();
    const candidates = await this.prisma.flightPricingRule.findMany({
      where: {
        isActive: true,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validTo: null }, { validTo: { gte: now } }] }],
      },
    });

    const matches = candidates.filter((rule) => {
      if (rule.airlineCode && rule.airlineCode !== context.airlineCode)
        return false;
      if (rule.origin && rule.origin !== context.origin) return false;
      if (rule.destination && rule.destination !== context.destination)
        return false;
      if (rule.cabinClass && rule.cabinClass !== context.cabinClass)
        return false;
      if (rule.staffId && rule.staffId !== context.staffId) return false;
      if (rule.branchId && rule.branchId !== context.branchId) return false;
      return true;
    });

    if (matches.length === 0) return null;

    const specificity = (rule: FlightPricingRule) =>
      [
        rule.airlineCode,
        rule.origin,
        rule.destination,
        rule.cabinClass,
        rule.staffId,
        rule.branchId,
      ].filter(Boolean).length;

    matches.sort(
      (a, b) => b.priority - a.priority || specificity(b) - specificity(a),
    );
    return matches[0];
  }

  applyMarkup(
    providerCost: number,
    rule: FlightPricingRule | null,
  ): PricingResult {
    if (!rule) {
      return { customerPrice: providerCost, markupAmount: 0, rule: null };
    }
    const markupAmount =
      rule.type === 'FIXED'
        ? (rule.amount ?? 0)
        : Math.round((providerCost * (rule.percent ?? 0)) / 100);
    return { customerPrice: providerCost + markupAmount, markupAmount, rule };
  }

  async priceOffer(
    providerCost: number,
    context: PricingContext,
  ): Promise<PricingResult> {
    const rule = await this.resolveRule(context);
    return this.applyMarkup(providerCost, rule);
  }

  listRules() {
    return this.prisma.flightPricingRule.findMany({
      include: {
        staff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  createRule(dto: CreateFlightPricingRuleDto) {
    return this.prisma.flightPricingRule.create({
      data: dto,
    });
  }

  updateRule(id: string, dto: UpdateFlightPricingRuleDto) {
    return this.prisma.flightPricingRule.update({
      where: { id },
      data: dto,
    });
  }

  deleteRule(id: string) {
    return this.prisma.flightPricingRule.delete({ where: { id } });
  }
}
