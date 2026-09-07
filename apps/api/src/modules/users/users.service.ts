import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdentityType } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

function generateTemporaryPassword(): string {
  // 12 hex chars from random bytes, guaranteed to satisfy letter+digit policy
  return `Tmp${randomBytes(6).toString('hex')}!`;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Phase 11 spec #3/#65 fix — `dto.companyId` used to go straight to the
   * database with no check at all: any staff member holding STAFF.CREATE
   * could create a new staff account inside a DIFFERENT company just by
   * naming its id in the request body — a cross-tenant write, not just a
   * read leak. `tenantCompanyId` is resolveTenantFilter(user) from the
   * controller; undefined only for SUPER_ADMIN (who legitimately creates
   * staff for any tenant), enforced literally for everyone else.
   */
  async createStaff(dto: CreateStaffDto, tenantCompanyId?: string) {
    if (tenantCompanyId !== undefined && dto.companyId !== tenantCompanyId) {
      throw new ForbiddenException(
        'You can only create staff within your own company.',
      );
    }

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

    await this.notificationsService.sendStaffTempPassword(
      identity.email,
      dto.firstName,
      temporaryPassword,
    );

    return {
      staff: identity.staff,
      identityId: identity.id,
      email: identity.email,
      temporaryPassword,
    };
  }

  /** Resolves a Staff record id for the identity of the calling user, or null if none. */
  async getStaffIdForIdentity(identityId: string): Promise<string | null> {
    const staff = await this.prisma.staff.findUnique({
      where: { identityId },
      select: { id: true },
    });
    return staff?.id ?? null;
  }

  /**
   * Phase 11 spec #3/#65 fix — `companyId` used to be whatever the client
   * passed in the query string, meaning any authenticated staff member
   * (of ANY company) could list another company's whole staff roster just
   * by supplying its id. `tenantCompanyId` is resolveTenantFilter(user)
   * from the controller instead — undefined only for SUPER_ADMIN, applied
   * literally (never overridable by the request) for everyone else. The
   * `branchId` query param stays client-supplied since it only narrows
   * within whatever tenant scope already applies.
   */
  async findAll(branchId?: string, tenantCompanyId?: string) {
    return this.prisma.staff.findMany({
      where: {
        branchId,
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      include: { identity: { select: { email: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Same NotFound-not-Forbidden reasoning as CustomersService.findOne —
   * a cross-tenant id must never be distinguishable from a missing one. */
  async findOne(id: string, tenantCompanyId?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      include: {
        identity: {
          select: {
            email: true,
            phone: true,
            status: true,
            roles: { include: { role: true } },
          },
        },
        company: true,
        branch: true,
      },
    });
    if (
      !staff ||
      (tenantCompanyId !== undefined && staff.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  async update(id: string, dto: UpdateStaffDto, tenantCompanyId?: string) {
    await this.findOne(id, tenantCompanyId);

    const { isActive, ...rest } = dto;

    return this.prisma.staff.update({
      where: { id },
      data: {
        ...rest,
        isActive,
      },
    });
  }

  async remove(id: string, tenantCompanyId?: string) {
    const staff = await this.findOne(id, tenantCompanyId);
    await this.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });
    await this.prisma.identity.update({
      where: { id: staff.identityId },
      data: { status: 'DEACTIVATED' },
    });
  }
}
