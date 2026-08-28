import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminUpdateCustomerDto } from './dto/admin-update-customer.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(filters: { assignedStaffId?: string; assignedBranchId?: string } = {}) {
    return this.prisma.customer.findMany({
      where: filters,
      include: {
        identity: { select: { email: true, phone: true, status: true } },
        assignedStaff: { select: { firstName: true, lastName: true } },
        assignedBranch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** "My customers" — every customer assigned to this staff member. */
  listForStaff(staffId: string) {
    return this.findAll({ assignedStaffId: staffId });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        identity: { select: { email: true, phone: true, status: true } },
        documents: true,
        familyMembers: { orderBy: { createdAt: 'desc' } },
        assignedStaff: { select: { id: true, firstName: true, lastName: true } },
        assignedBranch: { select: { id: true, name: true } },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async getCustomerIdForIdentity(identityId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { identityId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }
    return customer.id;
  }

  async findByIdentityId(identityId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { identityId },
      include: {
        identity: { select: { email: true, phone: true, status: true } },
        documents: true,
        familyMembers: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }
    return customer;
  }

  async update(
    id: string,
    dto: AdminUpdateCustomerDto,
    actorIdentityId?: string,
  ) {
    const existing = await this.findOne(id);

    if (dto.assignedStaffId) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: dto.assignedStaffId },
      });
      if (!staff) {
        throw new NotFoundException('Assigned staff member not found');
      }
    }
    if (dto.assignedBranchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.assignedBranchId },
      });
      if (!branch) {
        throw new NotFoundException('Assigned branch not found');
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        passportExpiryDate: dto.passportExpiryDate
          ? new Date(dto.passportExpiryDate)
          : undefined,
        // Explicit null clears the assignment; undefined leaves it untouched.
        assignedStaffId:
          dto.assignedStaffId === null ? null : dto.assignedStaffId,
        assignedBranchId:
          dto.assignedBranchId === null ? null : dto.assignedBranchId,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'customer.updated',
      entityType: 'Customer',
      entityId: id,
      metadata: { changes: dto as unknown as Prisma.InputJsonValue },
    });

    // Called out separately per the audit trail spec's own "staff
    // assignment changed" bullet, distinct from a general profile edit.
    const staffChanged =
      dto.assignedStaffId !== undefined &&
      dto.assignedStaffId !== existing.assignedStaffId;
    const branchChanged =
      dto.assignedBranchId !== undefined &&
      dto.assignedBranchId !== existing.assignedBranchId;
    if (staffChanged || branchChanged) {
      await this.auditService.record({
        identityId: actorIdentityId,
        action: 'customer.staff_assignment_changed',
        entityType: 'Customer',
        entityId: id,
        metadata: {
          previousStaffId: existing.assignedStaffId,
          newStaffId: updated.assignedStaffId,
          previousBranchId: existing.assignedBranchId,
          newBranchId: updated.assignedBranchId,
        },
      });
    }

    return updated;
  }

  async updateByIdentityId(identityId: string, dto: UpdateCustomerProfileDto) {
    const customer = await this.findByIdentityId(identityId);
    return this.update(customer.id, dto, identityId);
  }

  async deactivate(id: string, actorIdentityId?: string) {
    const customer = await this.findOne(id);
    await this.prisma.identity.update({
      where: { id: customer.identityId },
      data: { status: 'DEACTIVATED' },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'customer.deactivated',
      entityType: 'Customer',
      entityId: id,
    });
  }
}
