import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  let service: RbacService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      role: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      permission: { findMany: jest.fn() },
      rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
      identityRole: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RbacService);
  });

  describe('createRole', () => {
    it('throws Conflict when a role with the same name exists', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });

      await expect(
        service.createRole({ name: 'STAFF', permissionKeys: [] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    it('throws NotFound when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole('missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects permission changes on system roles', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        isSystem: true,
      });

      await expect(
        service.updateRole('role-1', { permissionKeys: ['company:read'] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteRole', () => {
    it('rejects deleting a system role', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        isSystem: true,
      });

      await expect(service.deleteRole('role-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getEffectiveAccess', () => {
    it('aggregates unique roles and permissions across all assigned roles', async () => {
      prisma.identityRole.findMany.mockResolvedValue([
        {
          role: {
            name: 'BRANCH_MANAGER',
            permissions: [
              { permission: { key: 'branch:read' } },
              { permission: { key: 'branch:update' } },
            ],
          },
        },
        {
          role: {
            name: 'STAFF',
            permissions: [{ permission: { key: 'branch:read' } }],
          },
        },
      ]);

      const result = await service.getEffectiveAccess('identity-1');

      expect(result.roles.sort()).toEqual(['BRANCH_MANAGER', 'STAFF']);
      expect(result.permissions.sort()).toEqual([
        'branch:read',
        'branch:update',
      ]);
    });

    it('returns empty roles/permissions when the identity has no assignments', async () => {
      prisma.identityRole.findMany.mockResolvedValue([]);

      const result = await service.getEffectiveAccess('identity-1');

      expect(result).toEqual({ roles: [], permissions: [] });
    });
  });
});
