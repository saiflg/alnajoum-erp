import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_ROLES } from './constants/default-roles.constant';
import { AssignRoleDto } from './dto/assign-role.dto';
import { assertRoleGrantable } from './role-grant.policy';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
}

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listRoles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists`);
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.permissionKeys } },
    });

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: {
          create: permissions.map((permission) => ({
            permissionId: permission.id,
          })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async updateRole(roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystem && dto.permissionKeys) {
      throw new ConflictException('System role permissions cannot be modified');
    }

    if (dto.permissionKeys) {
      const permissions = await this.prisma.permission.findMany({
        where: { key: { in: dto.permissionKeys } },
      });
      await this.prisma.rolePermission.deleteMany({ where: { roleId } });
      await this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId,
          permissionId: permission.id,
        })),
      });
    }

    return this.prisma.role.update({
      where: { id: roleId },
      data: {
        name: dto.name,
        description: dto.description,
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async deleteRole(roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystem) {
      throw new ConflictException('System roles cannot be deleted');
    }
    await this.prisma.role.delete({ where: { id: roleId } });
  }

  /**
   * Phase 11 spec #66 — role-escalation protection. Before this, any
   * identity holding ROLE.ASSIGN (COMPANY_ADMIN included) could grant
   * SUPER_ADMIN to anyone, including themselves — a plain Tenant Admin
   * self-promoting to full platform access. `actingUser` is the caller;
   * only an identity that already holds SUPER_ADMIN may grant it to
   * someone else. Every other role assignment is unaffected.
   */
  async assignRoleToIdentity(
    identityId: string,
    dto: AssignRoleDto,
    actingUser?: { sub: string; roles: string[]; companyId?: string | null },
  ) {
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (
      role.name === SYSTEM_ROLES.SUPER_ADMIN &&
      !(actingUser?.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) ?? false)
    ) {
      await this.auditService.record({
        identityId: actingUser?.sub,
        action: 'security.role_escalation_blocked',
        entityType: 'Identity',
        entityId: identityId,
        metadata: { attemptedRole: role.name },
      });
      throw new ForbiddenException(
        'Only an existing Super Admin can grant the Super Admin role.',
      );
    }

    // A caller who is not a SUPER_ADMIN is confined to their own company: the target identity must
    // belong to it (another company's identity is a 404), the grant is recorded against that company
    // whatever the request says, any branch must belong to it, and the role must not exceed the
    // caller's own permissions. `actingUser` is undefined only for internal/seed callers.
    let companyId = dto.companyId;
    if (actingUser && !actingUser.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
      const tenant = actingUser.companyId ?? '__no_tenant__';
      await this.assertIdentityInCompany(identityId, tenant);
      await assertRoleGrantable(this.prisma, actingUser, role);
      companyId = tenant;
      if (dto.branchId) {
        const branch = await this.prisma.branch.findFirst({
          where: { id: dto.branchId, companyId: tenant },
          select: { id: true },
        });
        if (!branch) throw new NotFoundException('Branch not found');
      }
    }

    await this.auditService.record({
      identityId: actingUser?.sub,
      action: 'security.role_changed',
      entityType: 'Identity',
      entityId: identityId,
      metadata: { roleGranted: role.name },
    });

    return this.prisma.identityRole.upsert({
      where: { identityId_roleId: { identityId, roleId: dto.roleId } },
      create: {
        identityId,
        roleId: dto.roleId,
        companyId,
        branchId: dto.branchId,
      },
      update: {
        companyId,
        branchId: dto.branchId,
      },
    });
  }

  /** An identity belongs to a company through its customer or staff profile. */
  private async assertIdentityInCompany(identityId: string, companyId: string) {
    const identity = await this.prisma.identity.findFirst({
      where: {
        id: identityId,
        OR: [{ customer: { companyId } }, { staff: { companyId } }],
      },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Identity not found');
  }

  async removeRoleFromIdentity(
    identityId: string,
    roleId: string,
    actingUser?: { sub: string; roles: string[]; companyId?: string | null },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (
      role?.name === SYSTEM_ROLES.SUPER_ADMIN &&
      !(actingUser?.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) ?? false)
    ) {
      throw new ForbiddenException(
        'Only an existing Super Admin can remove the Super Admin role.',
      );
    }
    if (actingUser && !actingUser.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
      await this.assertIdentityInCompany(
        identityId,
        actingUser.companyId ?? '__no_tenant__',
      );
    }

    await this.prisma.identityRole.delete({
      where: { identityId_roleId: { identityId, roleId } },
    });
    await this.auditService.record({
      identityId: actingUser?.sub,
      action: 'security.role_changed',
      entityType: 'Identity',
      entityId: identityId,
      metadata: { roleRemoved: role?.name },
    });
  }

  /** Aggregates role names + the union of their permission keys for an identity. */
  async getEffectiveAccess(identityId: string): Promise<EffectiveAccess> {
    const identityRoles = await this.prisma.identityRole.findMany({
      where: { identityId },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });

    const roles = new Set<string>();
    const permissions = new Set<string>();

    for (const identityRole of identityRoles) {
      roles.add(identityRole.role.name);
      for (const rolePermission of identityRole.role.permissions) {
        permissions.add(rolePermission.permission.key);
      }
    }

    return { roles: [...roles], permissions: [...permissions] };
  }
}
