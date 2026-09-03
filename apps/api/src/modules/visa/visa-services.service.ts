import { Injectable, NotFoundException } from '@nestjs/common';
import { VisaServiceStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateVisaServiceDto } from './dto/create-visa-service.dto';
import { UpdateVisaServiceDto } from './dto/update-visa-service.dto';

function generateServiceCode(): string {
  return `VS-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** margin is always derived, never stored — see VisaService's schema.prisma doc comment. */
export function computeMargin(
  companyCost: number,
  sellingPrice: number,
): number {
  return sellingPrice - companyCost;
}

/**
 * The visa "product catalog" administrators configure — country, visa type,
 * costing, and (optionally) which IncentivePolicy governs the staff
 * incentive on sales of this service. Selling price/company cost are plain
 * admin-entered numbers; margin is computed wherever it's needed
 * (getService/listServices below, and VisaIncentivesService), never stored.
 */
@Injectable()
export class VisaServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private withMargin<T extends { companyCost: number; sellingPrice: number }>(
    service: T,
  ): T & { margin: number } {
    return {
      ...service,
      margin: computeMargin(service.companyCost, service.sellingPrice),
    };
  }

  async create(dto: CreateVisaServiceDto, actorIdentityId?: string) {
    const created = await this.prisma.visaService.create({
      data: { ...dto, serviceCode: generateServiceCode() },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'visa_service.created',
      entityType: 'VisaService',
      entityId: created.id,
      metadata: { serviceCode: created.serviceCode, country: created.country },
    });
    return this.withMargin(created);
  }

  async update(
    id: string,
    dto: UpdateVisaServiceDto,
    actorIdentityId?: string,
  ) {
    const existing = await this.getRaw(id);
    const updated = await this.prisma.visaService.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'visa_service.updated',
      entityType: 'VisaService',
      entityId: id,
      metadata: {
        previous: {
          companyCost: existing.companyCost,
          sellingPrice: existing.sellingPrice,
          status: existing.status,
        },
        next: {
          companyCost: updated.companyCost,
          sellingPrice: updated.sellingPrice,
          status: updated.status,
        },
      },
    });
    return this.withMargin(updated);
  }

  async list(filters: {
    status?: VisaServiceStatus;
    country?: string;
    isAvailable?: boolean;
  }) {
    const services = await this.prisma.visaService.findMany({
      where: {
        status: filters.status,
        country: filters.country,
        isAvailable: filters.isAvailable,
      },
      include: { incentivePolicy: true },
      orderBy: { createdAt: 'desc' },
    });
    return services.map((s) => this.withMargin(s));
  }

  /** Customer/public-facing list — active + available services only, still includes cost/margin since this is an internal (staff) read; the customer-facing controller strips those fields before responding. */
  async listActive() {
    const services = await this.prisma.visaService.findMany({
      where: { status: 'ACTIVE', isAvailable: true },
      orderBy: { country: 'asc' },
    });
    return services.map((s) => this.withMargin(s));
  }

  private async getRaw(id: string) {
    const service = await this.prisma.visaService.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Visa service not found');
    }
    return service;
  }

  async get(id: string) {
    const service = await this.prisma.visaService.findUnique({
      where: { id },
      include: { incentivePolicy: true },
    });
    if (!service) {
      throw new NotFoundException('Visa service not found');
    }
    return this.withMargin(service);
  }
}
