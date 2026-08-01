import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
}

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

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

  async assignRoleToIdentity(identityId: string, dto: AssignRoleDto) {
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.prisma.identityRole.upsert({
      where: { identityId_roleId: { identityId, roleId: dto.roleId } },
      create: {
        identityId,
        roleId: dto.roleId,
        companyId: dto.companyId,
        branchId: dto.branchId,
      },
      update: {
        companyId: dto.companyId,
        branchId: dto.branchId,
      },
    });
  }

  async removeRoleFromIdentity(identityId: string, roleId: string) {
    await this.prisma.identityRole.delete({
      where: { identityId_roleId: { identityId, roleId } },
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
