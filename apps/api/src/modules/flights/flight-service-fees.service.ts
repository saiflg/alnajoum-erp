import { Injectable, NotFoundException } from '@nestjs/common';
import { FlightServiceFeeType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightServiceFeeDto } from './dto/create-flight-service-fee.dto';
import { UpdateFlightServiceFeeDto } from './dto/update-flight-service-fee.dto';

/**
 * Phase 10 spec #26 — configurable flat/percentage agency fees (booking,
 * ticketing, cancellation, refund processing, reissue, change, ancillary),
 * layered on top of FlightPricingService's fare markup rather than folded
 * into it — a service fee is a flat agency charge independent of route/
 * airline, so it deliberately has none of FlightPricingRule's scope
 * matching. The single active fee for a type applies; resolve() returns 0
 * when none is configured, never a hard-coded default.
 */
@Injectable()
export class FlightServiceFeesService {
  constructor(private readonly prisma: PrismaService) {}

  listAll() {
    return this.prisma.flightServiceFee.findMany({
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(dto: CreateFlightServiceFeeDto) {
    return this.prisma.flightServiceFee.create({ data: dto });
  }

  private async get(id: string) {
    const fee = await this.prisma.flightServiceFee.findUnique({
      where: { id },
    });
    if (!fee) throw new NotFoundException('Service fee not found');
    return fee;
  }

  async update(id: string, dto: UpdateFlightServiceFeeDto) {
    await this.get(id);
    return this.prisma.flightServiceFee.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.get(id);
    await this.prisma.flightServiceFee.delete({ where: { id } });
  }

  /**
   * Computed fee for a given type against a base amount — `amount` (flat)
   * wins if the active fee has one set, otherwise `percent` of `baseAmount`
   * applies; 0 when no active fee exists for this type at all, so an
   * untouched install behaves exactly as it did before this phase.
   */
  async resolve(
    type: FlightServiceFeeType,
    baseAmount: number,
  ): Promise<number> {
    const fee = await this.prisma.flightServiceFee.findFirst({
      where: { type, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!fee) return 0;
    if (fee.amount != null) return fee.amount;
    if (fee.percent != null)
      return Math.round(baseAmount * (fee.percent / 100));
    return 0;
  }
}
