import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TravelGroupStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateHajjGroupDto } from './dto/create-group.dto';

function generateGroupNumber(): string {
  return `HGRP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Spec #5 — Hajj group lifecycle (Planning → ... → Completed/Cancelled).
 * A group is a pure travel-cohort container: pilgrims already exist as
 * HajjRegistrationPilgrim rows (see schema.prisma header) and are only
 * *assigned* to a group here, never re-created.
 */
@Injectable()
export class HajjGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateHajjGroupDto) {
    const group = await this.prisma.hajjGroup.create({
      data: {
        groupNumber: generateGroupNumber(),
        name: dto.name,
        packageId: dto.packageId,
        departureDate: dto.departureDate
          ? new Date(dto.departureDate)
          : undefined,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined,
        airline: dto.airline,
        maxCapacity: dto.maxCapacity,
        coordinatorStaffId: dto.coordinatorStaffId,
        notes: dto.notes,
      },
    });
    await this.auditService.record({
      action: 'hajj_group.created',
      entityType: 'HajjGroup',
      entityId: group.id,
    });
    return group;
  }

  listAll(filters: { status?: TravelGroupStatus; packageId?: string }) {
    return this.prisma.hajjGroup.findMany({
      where: filters,
      include: {
        package: { select: { name: true } },
        coordinatorStaff: { select: { firstName: true, lastName: true } },
        _count: { select: { pilgrims: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const group = await this.prisma.hajjGroup.findUnique({
      where: { id },
      include: {
        package: true,
        coordinatorStaff: { select: { firstName: true, lastName: true } },
        pilgrims: {
          include: {
            customer: { select: { firstName: true, lastName: true } },
            familyMember: { select: { firstName: true, lastName: true } },
            registration: { select: { registrationNumber: true } },
          },
        },
        transports: true,
      },
    });
    if (!group) {
      throw new NotFoundException('Hajj group not found');
    }
    return group;
  }

  async updateStatus(id: string, status: TravelGroupStatus) {
    await this.get(id);
    const updated = await this.prisma.hajjGroup.update({
      where: { id },
      data: { status },
    });
    await this.auditService.record({
      action: 'hajj_group.status_changed',
      entityType: 'HajjGroup',
      entityId: id,
      metadata: { status },
    });
    return updated;
  }

  /** Spec #4 — assigns an existing pilgrim to this group; never duplicates the underlying customer/family record. */
  async assignPilgrim(groupId: string, pilgrimId: string) {
    const group = await this.get(groupId);
    const pilgrim = await this.prisma.hajjRegistrationPilgrim.findUnique({
      where: { id: pilgrimId },
    });
    if (!pilgrim) {
      throw new NotFoundException('Pilgrim not found');
    }
    if (group.maxCapacity) {
      const currentCount = await this.prisma.hajjRegistrationPilgrim.count({
        where: { groupId },
      });
      if (currentCount >= group.maxCapacity && pilgrim.groupId !== groupId) {
        throw new BadRequestException('This group is at full capacity');
      }
    }
    const updated = await this.prisma.hajjRegistrationPilgrim.update({
      where: { id: pilgrimId },
      data: { groupId },
    });
    await this.auditService.record({
      action: 'hajj_group.pilgrim_assigned',
      entityType: 'HajjGroup',
      entityId: groupId,
      metadata: { pilgrimId },
    });
    return updated;
  }

  async removePilgrim(groupId: string, pilgrimId: string) {
    const pilgrim = await this.prisma.hajjRegistrationPilgrim.findUnique({
      where: { id: pilgrimId },
    });
    if (!pilgrim || pilgrim.groupId !== groupId) {
      throw new ConflictException('This pilgrim is not in this group');
    }
    return this.prisma.hajjRegistrationPilgrim.update({
      where: { id: pilgrimId },
      data: { groupId: null },
    });
  }
}
