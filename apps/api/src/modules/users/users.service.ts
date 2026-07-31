import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdentityType } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

function generateTemporaryPassword(): string {
  // 12 hex chars from random bytes, guaranteed to satisfy letter+digit policy
  return `Tmp${randomBytes(6).toString('hex')}!`;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createStaff(dto: CreateStaffDto) {
    const existing = await this.prisma.identity.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const [company, role] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: dto.companyId } }),
      this.prisma.role.findUnique({ where: { id: dto.roleId } }),
    ]);
    if (!company) throw new NotFoundException('Company not found');
    if (!role) throw new NotFoundException('Role not found');

    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch) throw new NotFoundException('Branch not found');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    const identity = await this.prisma.identity.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        type: IdentityType.STAFF,
        status: 'ACTIVE',
        staff: {
          create: {
            companyId: dto.companyId,
            branchId: dto.branchId,
            employeeCode: dto.employeeCode,
            firstName: dto.firstName,
            lastName: dto.lastName,
            jobTitle: dto.jobTitle,
            department: dto.department,
          },
        },
        roles: { create: [{ roleId: dto.roleId }] },
      },
      include: { staff: true },
    });

    return {
      staff: identity.staff,
      identityId: identity.id,
      email: identity.email,
      temporaryPassword,
    };
  }

  async findAll(companyId?: string, branchId?: string) {
    return this.prisma.staff.findMany({
      where: { companyId, branchId },
      include: { identity: { select: { email: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      include: {
        identity: {
          select: { email: true, phone: true, status: true, roles: { include: { role: true } } },
        },
        company: true,
        branch: true,
      },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    const { isActive, ...rest } = dto;

    return this.prisma.staff.update({
      where: { id },
      data: {
        ...rest,
        isActive,
      },
    });
  }

  async remove(id: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    await this.prisma.staff.update({ where: { id }, data: { isActive: false } });
    await this.prisma.identity.update({
      where: { id: staff.identityId },
      data: { status: 'DEACTIVATED' },
    });
  }
}
