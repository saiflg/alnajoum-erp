import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';

/**
 * Phase 17 — tenant-scoped negotiated rate plans for a (platform-wide)
 * HotelRoomType. RatePlan.companyId is a plain, one-directional FK (see the
 * schema's own doc comment on why Hotel/HotelRoomType never gain a
 * reciprocal relation back to a single tenant) — every read/write here is
 * scoped by that column directly rather than joining through the room type.
 */
@Injectable()
export class RatePlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(
    filters: { roomTypeId?: string; isActive?: boolean } = {},
    tenantCompanyId?: string,
  ) {
    return this.prisma.ratePlan.findMany({
      where: {
        ...(filters.roomTypeId && { roomTypeId: filters.roomTypeId }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      include: {
        roomType: { select: { name: true, hotelId: true } },
        supplier: { select: { legalName: true } },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async get(id: string, tenantCompanyId?: string) {
    const ratePlan = await this.prisma.ratePlan.findUnique({
      where: { id },
      include: {
        roomType: { select: { name: true, hotelId: true } },
        supplier: { select: { legalName: true } },
      },
    });
    if (
      !ratePlan ||
      (tenantCompanyId !== undefined && ratePlan.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Rate plan not found');
    }
    return ratePlan;
  }

  async create(
    dto: CreateRatePlanDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    const roomType = await this.prisma.hotelRoomType.findUnique({
      where: { id: dto.roomTypeId },
    });
    if (!roomType) {
      throw new NotFoundException('Room type not found');
    }
    const ratePlan = await this.prisma.ratePlan.create({
      data: {
        ...dto,
        companyId,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'rate_plan.created',
      entityType: 'RatePlan',
      entityId: ratePlan.id,
      companyId,
      metadata: {
        roomTypeId: dto.roomTypeId,
        name: ratePlan.name,
        netPrice: ratePlan.netPrice,
      },
    });
    return ratePlan;
  }

  async update(
    id: string,
    dto: UpdateRatePlanDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    const updated = await this.prisma.ratePlan.update({
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
      action: 'rate_plan.updated',
      entityType: 'RatePlan',
      entityId: id,
      companyId: existing.companyId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(
    id: string,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    await this.prisma.ratePlan.delete({ where: { id } });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'rate_plan.deleted',
      entityType: 'RatePlan',
      entityId: id,
      companyId: existing.companyId,
    });
  }

  /**
   * The booking-time lookup HotelsService.resolveSupplierCost() calls —
   * never used on the public search path (see hotels.controller.ts:
   * search/getOffer are both @Public(), so no companyId is resolvable
   * there). Picks the plan whose effective window fully covers the stay;
   * when more than one matches, the most recently created wins, on the
   * assumption a newer negotiated rate supersedes an older overlapping one.
   */
  async findApplicable(
    companyId: string,
    roomTypeId: string,
    checkInDate: string | Date,
    checkOutDate: string | Date,
  ) {
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    return this.prisma.ratePlan.findFirst({
      where: {
        companyId,
        roomTypeId,
        isActive: true,
        effectiveFrom: { lte: checkIn },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: checkOut } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
