import { Injectable, NotFoundException } from '@nestjs/common';
import { FlightProviderName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightProviderRoutingRuleDto } from './dto/create-flight-provider-routing-rule.dto';
import { UpdateFlightProviderRoutingRuleDto } from './dto/update-flight-provider-routing-rule.dto';

/**
 * Phase 10 spec #30 — administrator-configured provider try-order for
 * flight search. Deliberately search-only: resolveOrder() is consulted by
 * FlightsService.search() alone, never by booking/ticketing/refund/
 * reissue, which always address whichever provider actually holds the
 * order — see spec #31's duplicate-booking protection and
 * FlightProviderRouter.resolveByName's own doc comment.
 */
@Injectable()
export class FlightProviderRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  listAll() {
    return this.prisma.flightProviderRoutingRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(dto: CreateFlightProviderRoutingRuleDto) {
    return this.prisma.flightProviderRoutingRule.create({
      data: {
        origin: dto.origin,
        destination: dto.destination,
        providerPriority: dto.providerPriority,
        priority: dto.priority,
        isActive: dto.isActive,
      },
    });
  }

  private async get(id: string) {
    const rule = await this.prisma.flightProviderRoutingRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Provider routing rule not found');
    return rule;
  }

  async update(id: string, dto: UpdateFlightProviderRoutingRuleDto) {
    await this.get(id);
    return this.prisma.flightProviderRoutingRule.update({
      where: { id },
      data: {
        origin: dto.origin,
        destination: dto.destination,
        providerPriority: dto.providerPriority,
        priority: dto.priority,
        isActive: dto.isActive,
      },
    });
  }

  async delete(id: string) {
    await this.get(id);
    await this.prisma.flightProviderRoutingRule.delete({ where: { id } });
  }

  /**
   * The most specific active rule wins: an exact (origin, destination)
   * match beats an origin-only or destination-only match, which beats the
   * fully-global rule (both null). Returns [] — "no fallback configured,
   * use whichever single provider is active" — when nothing matches at
   * all, preserving the pre-Phase-10 single-provider behavior exactly for
   * anyone who never opens this settings screen.
   */
  async resolveOrder(
    origin?: string,
    destination?: string,
  ): Promise<FlightProviderName[]> {
    const rules = await this.prisma.flightProviderRoutingRule.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    const scoreOf = (rule: {
      origin: string | null;
      destination: string | null;
    }) => {
      if (rule.origin && rule.origin !== origin) return null;
      if (rule.destination && rule.destination !== destination) return null;
      return (rule.origin ? 1 : 0) + (rule.destination ? 1 : 0);
    };

    let best: { score: number; providerPriority: unknown } | null = null;
    for (const rule of rules) {
      const score = scoreOf(rule);
      if (score === null) continue;
      if (!best || score > best.score) {
        best = { score, providerPriority: rule.providerPriority };
      }
    }

    if (!best) return [];
    return (best.providerPriority as string[]).map(
      (name) => FlightProviderName[name as keyof typeof FlightProviderName],
    );
  }
}
