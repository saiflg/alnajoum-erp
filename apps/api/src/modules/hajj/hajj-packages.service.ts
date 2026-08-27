import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PackageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateHajjPackageDto } from './dto/create-hajj-package.dto';
import { UpdateHajjPackageDto } from './dto/update-hajj-package.dto';

@Injectable()
export class HajjPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateHajjPackageDto, actorIdentityId?: string) {
    const pkg = await this.prisma.hajjPackage.create({
      data: {
        ...dto,
        seatsAvailable: dto.seatsAvailable ?? dto.maxPilgrims,
        departureDate: dto.departureDate ? new Date(dto.departureDate) : undefined,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hajj_package.created',
      entityType: 'HajjPackage',
      entityId: pkg.id,
      metadata: { name: pkg.name, price: pkg.price },
    });
    return pkg;
  }

  /** Admin listing — every status, includes internalCost. */
  findAllAdmin(status?: PackageStatus) {
    return this.prisma.hajjPackage.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Customer-facing catalogue — published only, cost price stripped. */
  async findAllPublished() {
    const packages = await this.prisma.hajjPackage.findMany({
      where: { status: PackageStatus.PUBLISHED },
      orderBy: { departureDate: 'asc' },
    });
    return packages.map(({ internalCost: _internalCost, ...rest }) => rest);
  }

  async findOne(id: string, hideCost = false) {
    const pkg = await this.prisma.hajjPackage.findUnique({ where: { id } });
    if (!pkg) {
      throw new NotFoundException('Hajj package not found');
    }
    if (hideCost) {
      const { internalCost: _internalCost, ...rest } = pkg;
      return rest;
    }
    return pkg;
  }

  async update(id: string, dto: UpdateHajjPackageDto, actorIdentityId?: string) {
    await this.findOne(id);
    const updated = await this.prisma.hajjPackage.update({
      where: { id },
      data: {
        ...dto,
        departureDate: dto.departureDate ? new Date(dto.departureDate) : undefined,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hajj_package.updated',
      entityType: 'HajjPackage',
      entityId: id,
      metadata: { changes: dto as unknown as Prisma.InputJsonValue },
    });
    return updated;
  }

  async remove(id: string) {
    const pkg = await this.prisma.hajjPackage.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
    if (!pkg) {
      throw new NotFoundException('Hajj package not found');
    }
    if (pkg._count.registrations > 0) {
      throw new ConflictException(
        'This package has registrations against it — close or cancel it instead of deleting',
      );
    }
    await this.prisma.hajjPackage.delete({ where: { id } });
  }
}
