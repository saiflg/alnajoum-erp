import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IdentityType, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assertRoleGrantable } from '../rbac/role-grant.policy';
import { AuditService } from '../audit/audit.service';
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
    private readonly auditService: AuditService,
    // Optional so staff management never depends on the card module being present.
    @Optional() private readonly events?: EventEmitter2,
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
  async createStaff(
    dto: CreateStaffDto,
    tenantCompanyId?: string,
    actingUser?: { sub: string; roles: string[] },
  ) {
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

    // The new account's role is a grant like any other: a non-SUPER_ADMIN creator may not hand out
    // SUPER_ADMIN or any role stronger than their own. A tenant-scoped call with no acting user is
    // refused rather than trusted.
    if (tenantCompanyId !== undefined && !actingUser) {
      throw new ForbiddenException(
        'Cannot determine who is creating this account.',
      );
    }
    if (actingUser) {
      await assertRoleGrantable(this.prisma, actingUser, role);
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch || branch.companyId !== dto.companyId) {
        throw new NotFoundException('Branch not found');
      }
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    let identity: Prisma.IdentityGetPayload<{ include: { staff: true } }>;
    try {
      identity = await this.prisma.identity.create({
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
    } catch (error) {
      // A duplicate employee code (or a phone/email that lost a race) is the caller's mistake, not a server fault.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const meta = error.meta as { target?: string[] | string } | undefined;
        const target = Array.isArray(meta?.target)
          ? meta.target.join(',')
          : (meta?.target ?? '');
        throw new ConflictException(
          target.includes('employeeCode')
            ? 'A staff member with this employee code already exists'
            : target.includes('phone')
              ? 'An account with this phone number already exists'
              : 'An account with these details already exists',
        );
      }
      throw error;
    }

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
      // Payout account numbers are never part of a staff list/detail (only the owner's own payout view and
      // Finance's verification screen show them).
      omit: { bankAccountNumber: true },
      include: {
        identity: {
          select: {
            email: true,
            status: true,
            roles: { select: { role: { select: { id: true, name: true } } } },
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Same NotFound-not-Forbidden reasoning as CustomersService.findOne —
   * a cross-tenant id must never be distinguishable from a missing one. */
  async findOne(id: string, tenantCompanyId?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      omit: { bankAccountNumber: true },
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
    const current = await this.findOne(id, tenantCompanyId);
    // A branch must belong to the staff member's own company (it used to be written unchecked).
    if (dto.branchId)
      await this.assertBranchInCompany(dto.branchId, current.companyId);

    const { isActive, ...rest } = dto;

    return this.prisma.staff.update({
      where: { id },
      data: {
        ...rest,
        isActive,
      },
    });
  }

  /**
   * "Deleting" a staff member removes their access and keeps their history: bookings, incentives, payouts, ledger
   * entries and the audit trail all point at the staff record, and none of that may disappear. They can no longer
   * sign in, every open session ends at once and their identification cards stop working. A mistake can be undone
   * with `reactivate`.
   */
  async remove(
    id: string,
    tenantCompanyId?: string,
    actingIdentityId?: string,
    reason?: string,
  ) {
    const staff = await this.findOne(id, tenantCompanyId);
    if (actingIdentityId && staff.identityId === actingIdentityId) {
      throw new ForbiddenException('You cannot remove your own account.');
    }
    const isSuperAdmin = staff.identity.roles.some(
      (r) => r.role.name === 'SUPER_ADMIN',
    );
    if (isSuperAdmin) {
      const others = await this.prisma.identity.count({
        where: {
          id: { not: staff.identityId },
          status: 'ACTIVE',
          roles: { some: { role: { name: 'SUPER_ADMIN' } } },
        },
      });
      if (others === 0) {
        throw new ConflictException(
          'This is the only active Super Admin. Make someone else a Super Admin before removing this account.',
        );
      }
    }
    await this.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });
    await this.prisma.identity.update({
      where: { id: staff.identityId },
      data: { status: 'DEACTIVATED' },
    });
    // Deactivation ends every session immediately.
    await this.prisma.refreshToken.updateMany({
      where: { identityId: staff.identityId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Phase 26: the identification cards of someone who has left stop working at once (their history is kept).
    this.events?.emit('staff.deactivated', { staffId: staff.id });
    await this.auditService.record({
      identityId: actingIdentityId,
      action: 'staff.removed',
      entityType: 'Staff',
      entityId: staff.id,
      companyId: staff.companyId,
      reason,
      metadata: { employeeCode: staff.employeeCode },
    });
    return { removed: true };
  }

  /** Undoes `remove`: the person can sign in again. Their identification cards stay revoked and are issued anew. */
  async reactivate(
    id: string,
    tenantCompanyId?: string,
    actingIdentityId?: string,
  ) {
    const staff = await this.findOne(id, tenantCompanyId);
    await this.prisma.staff.update({
      where: { id },
      data: { isActive: true },
    });
    await this.prisma.identity.update({
      where: { id: staff.identityId },
      data: { status: 'ACTIVE' },
    });
    await this.auditService.record({
      identityId: actingIdentityId,
      action: 'staff.reactivated',
      entityType: 'Staff',
      entityId: staff.id,
      companyId: staff.companyId,
      metadata: { employeeCode: staff.employeeCode },
    });
    return { reactivated: true };
  }

  /**
   * Gives a staff member a new temporary password when they have forgotten theirs. A password is stored only as a
   * one-way hash, so the old one can never be shown; this issues a fresh one instead. It is returned once to the
   * administrator (to pass on in person) and is not sent by email or written to any log. The person must replace it
   * before doing anything else, every open session ends, and a lock from too many wrong attempts is cleared.
   *
   * Guards: not your own account (use Change password), never someone holding a stronger role than yours (otherwise
   * a branch manager could reset an administrator's password and take the account over), and only inside your company.
   */
  async resetPassword(
    id: string,
    tenantCompanyId: string | undefined,
    actingUser: { sub: string; roles: string[] },
  ) {
    const staff = await this.findOne(id, tenantCompanyId);
    if (staff.identityId === actingUser.sub) {
      throw new ForbiddenException(
        'Use Change password on your own account instead.',
      );
    }
    for (const r of staff.identity.roles) {
      await assertRoleGrantable(this.prisma, actingUser, r.role);
    }
    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.identity.update({
      where: { id: staff.identityId },
      data: {
        passwordHash: await argon2.hash(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.prisma.refreshToken.updateMany({
      where: { identityId: staff.identityId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record({
      identityId: actingUser.sub,
      action: 'staff.password_reset',
      entityType: 'Staff',
      entityId: staff.id,
      companyId: staff.companyId,
      metadata: { employeeCode: staff.employeeCode },
    });
    return {
      temporaryPassword,
      email: staff.identity.email,
      mustChangePassword: true,
    };
  }

  private async assertBranchInCompany(branchId: string, companyId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch || branch.companyId !== companyId) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  /** The actor may change this person only if none of their roles is stronger than the actor's own. */
  private async assertMayManage(
    staff: {
      identityId: string;
      identity: { roles: { role: { id: string; name: string } }[] };
    },
    actingUser: { sub: string; roles: string[] },
  ) {
    if (staff.identityId === actingUser.sub) {
      throw new ForbiddenException(
        'You cannot change your own branch or role. Ask another administrator.',
      );
    }
    for (const r of staff.identity.roles) {
      await assertRoleGrantable(this.prisma, actingUser, r.role);
    }
  }

  /**
   * Moves a staff member to another branch of the same company (or to no branch). Anything the person did before stays
   * on the branch it happened under; only what they do from now on belongs to the new one. The move is recorded with
   * who made it and why. A printed ID card keeps the old branch name until it is printed again.
   */
  async transfer(
    id: string,
    dto: { branchId?: string | null; reason?: string },
    tenantCompanyId: string | undefined,
    actingUser: { sub: string; roles: string[] },
  ) {
    const staff = await this.findOne(id, tenantCompanyId);
    await this.assertMayManage(staff, actingUser);
    const toBranchId = dto.branchId ?? null;
    if (toBranchId === (staff.branchId ?? null)) {
      throw new BadRequestException(
        toBranchId
          ? 'This person is already in that branch.'
          : 'This person is not in any branch.',
      );
    }
    const target = toBranchId
      ? await this.assertBranchInCompany(toBranchId, staff.companyId)
      : null;
    await this.prisma.$transaction([
      this.prisma.staff.update({
        where: { id },
        data: { branchId: toBranchId },
      }),
      // A role that was limited to the old branch moves with the person.
      this.prisma.identityRole.updateMany({
        where: { identityId: staff.identityId, branchId: { not: null } },
        data: { branchId: toBranchId },
      }),
    ]);
    await this.auditService.record({
      identityId: actingUser.sub,
      action: 'staff.transferred',
      entityType: 'Staff',
      entityId: staff.id,
      companyId: staff.companyId,
      branchId: toBranchId ?? undefined,
      reason: dto.reason,
      metadata: {
        employeeCode: staff.employeeCode,
        fromBranchId: staff.branchId,
        fromBranch: staff.branch?.name ?? null,
        toBranchId,
        toBranch: target?.name ?? null,
      },
    });
    return { transferred: true, branchId: toBranchId };
  }

  /**
   * Promotion or demotion: replaces the person's role with another. The same ceiling applies as when roles are first
   * granted: nobody can give a role stronger than their own, and nobody can change someone who already holds a
   * stronger one. Takes effect on the person's next request. The change is recorded with who made it and why.
   */
  async changeRole(
    id: string,
    dto: { roleId: string; reason?: string },
    tenantCompanyId: string | undefined,
    actingUser: { sub: string; roles: string[] },
  ) {
    const staff = await this.findOne(id, tenantCompanyId);
    await this.assertMayManage(staff, actingUser);
    const newRole = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!newRole) throw new NotFoundException('Role not found');
    if (newRole.name === 'CUSTOMER') {
      throw new BadRequestException(
        'A staff member cannot hold the Customer role.',
      );
    }
    await assertRoleGrantable(this.prisma, actingUser, newRole);

    const before = staff.identity.roles.map((r) => r.role.name);
    if (before.length === 1 && before[0] === newRole.name) {
      throw new BadRequestException('This person already has that role.');
    }
    if (before.includes('SUPER_ADMIN') && newRole.name !== 'SUPER_ADMIN') {
      const others = await this.prisma.identity.count({
        where: {
          id: { not: staff.identityId },
          status: 'ACTIVE',
          roles: { some: { role: { name: 'SUPER_ADMIN' } } },
        },
      });
      if (others === 0) {
        throw new ConflictException(
          'This is the only active Super Admin. Make someone else a Super Admin before changing this role.',
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.identityRole.deleteMany({
        where: { identityId: staff.identityId },
      }),
      this.prisma.identityRole.create({
        data: { identityId: staff.identityId, roleId: newRole.id },
      }),
    ]);
    await this.auditService.record({
      identityId: actingUser.sub,
      action: 'staff.role_changed',
      entityType: 'Staff',
      entityId: staff.id,
      companyId: staff.companyId,
      reason: dto.reason,
      metadata: {
        employeeCode: staff.employeeCode,
        from: before,
        to: newRole.name,
      },
    });
    return { changed: true, role: newRole.name };
  }

  /** What has happened to this person's employment record: moves, role changes, removals, password resets. */
  async history(id: string, tenantCompanyId?: string) {
    await this.findOne(id, tenantCompanyId);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'Staff',
        entityId: id,
        action: {
          in: [
            'staff.transferred',
            'staff.role_changed',
            'staff.removed',
            'staff.reactivated',
            'staff.password_reset',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        reason: true,
        metadata: true,
        createdAt: true,
        identity: { select: { email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      details: r.metadata,
      at: r.createdAt,
      by: r.identity?.email ?? null,
    }));
  }
}
