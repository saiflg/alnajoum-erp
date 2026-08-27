import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PackageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUmrahPackageDto } from './dto/create-umrah-package.dto';
import { UpdateUmrahPackageDto } from './dto/update-umrah-package.dto';

@Injectable()
export class UmrahPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateUmrahPackageDto, actorIdentityId?: string) {
    const pkg = await this.prisma.umrahPackage.create({
      data: {
        ...dto,
        incentiveRule: dto.incentiveRule as unknown as Prisma.InputJsonValue,
        seatsAvailable: dto.seatsAvailable ?? dto.maxPilgrims,
        departureDate: dto.departureDate ? new Date(dto.departureDate) : undefined,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'umrah_package.created',
      entityType: 'UmrahPackage',
      entityId: pkg.id,
      metadata: { name: pkg.name, sellingPrice: pkg.sellingPrice },
    });
    return pkg;
  }

  /** Admin listing — every status, includes cost price / incentive rule. */
  findAllAdmin(status?: PackageStatus) {
    return this.prisma.umrahPackage.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Customer-facing catalogue — published only, cost/incentive stripped. */
  async findAllPublished() {
    const packages = await this.prisma.umrahPackage.findMany({
      where: { status: PackageStatus.PUBLISHED },
      orderBy: { departureDate: 'asc' },
    });
    return packages.map(
      ({ costPrice: _costPrice, incentiveRule: _incentiveRule, ...rest }) => rest,
    );
  }

  async findOne(id: string, hideCost = false) {
    const pkg = await this.prisma.umrahPackage.findUnique({ where: { id } });
    if (!pkg) {
      throw new NotFoundException('Umrah package not found');
    }
    if (hideCost) {
      const { costPrice: _costPrice, incentiveRule: _incentiveRule, ...rest } = pkg;
      return rest;
    }
    return pkg;
  }

  async update(id: string, dto: UpdateUmrahPackageDto, actorIdentityId?: string) {
    await this.findOne(id);
    const updated = await this.prisma.umrahPackage.update({
      where: { id },
      data: {
        ...dto,
        incentiveRule:
          dto.incentiveRule !== undefined
            ? (dto.incentiveRule as unknown as Prisma.InputJsonValue)
            : undefined,
        departureDate: dto.departureDate ? new Date(dto.departureDate) : undefined,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'umrah_package.updated',
      entityType: 'UmrahPackage',
      entityId: id,
      metadata: { changes: dto as unknown as Prisma.InputJsonValue },
    });
    return updated;
  }

  async remove(id: string) {
    const pkg = await this.prisma.umrahPackage.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
    if (!pkg) {
      throw new NotFoundException('Umrah package not found');
    }
    if (pkg._count.registrations > 0) {
      throw new ConflictException(
        'This package has registrations against it — close or cancel it instead of deleting',
      );
    }
    await this.prisma.umrahPackage.delete({ where: { id } });
  }
}
