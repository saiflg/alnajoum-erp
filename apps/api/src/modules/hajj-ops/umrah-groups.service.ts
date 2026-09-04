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
import { CreateUmrahGroupDto } from './dto/create-group.dto';

function generateGroupNumber(): string {
  return `UGRP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Spec #6 — Umrah group lifecycle; same shape as HajjGroupsService, plus groupType (Individual/Family/Group/Corporate/VIP). */
@Injectable()
export class UmrahGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateUmrahGroupDto) {
    const group = await this.prisma.umrahGroup.create({
      data: {
        groupNumber: generateGroupNumber(),
        name: dto.name,
        groupType: dto.groupType,
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
      action: 'umrah_group.created',
      entityType: 'UmrahGroup',
      entityId: group.id,
    });
    return group;
  }

  listAll(filters: { status?: TravelGroupStatus; packageId?: string }) {
    return this.prisma.umrahGroup.findMany({
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
    const group = await this.prisma.umrahGroup.findUnique({
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
      throw new NotFoundException('Umrah group not found');
    }
    return group;
  }

  async updateStatus(id: string, status: TravelGroupStatus) {
    await this.get(id);
    const updated = await this.prisma.umrahGroup.update({
      where: { id },
      data: { status },
    });
    await this.auditService.record({
      action: 'umrah_group.status_changed',
      entityType: 'UmrahGroup',
      entityId: id,
      metadata: { status },
    });
    return updated;
  }

  async assignPilgrim(groupId: string, pilgrimId: string) {
    const group = await this.get(groupId);
    const pilgrim = await this.prisma.umrahRegistrationPilgrim.findUnique({
      where: { id: pilgrimId },
    });
    if (!pilgrim) {
      throw new NotFoundException('Pilgrim not found');
    }
    if (group.maxCapacity) {
      const currentCount = await this.prisma.umrahRegistrationPilgrim.count({
        where: { groupId },
      });
      if (currentCount >= group.maxCapacity && pilgrim.groupId !== groupId) {
        throw new BadRequestException('This group is at full capacity');
      }
    }
    const updated = await this.prisma.umrahRegistrationPilgrim.update({
      where: { id: pilgrimId },
      data: { groupId },
    });
    await this.auditService.record({
      action: 'umrah_group.pilgrim_assigned',
      entityType: 'UmrahGroup',
      entityId: groupId,
      metadata: { pilgrimId },
    });
    return updated;
  }

  async removePilgrim(groupId: string, pilgrimId: string) {
    const pilgrim = await this.prisma.umrahRegistrationPilgrim.findUnique({
      where: { id: pilgrimId },
    });
    if (!pilgrim || pilgrim.groupId !== groupId) {
      throw new ConflictException('This pilgrim is not in this group');
    }
    return this.prisma.umrahRegistrationPilgrim.update({
      where: { id: pilgrimId },
      data: { groupId: null },
    });
  }
}
