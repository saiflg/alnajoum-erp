import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  let service: RbacService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let auditService: { record: jest.Mock };

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
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
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

  describe('assignRoleToIdentity', () => {
    it('throws NotFound for a missing role', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.assignRoleToIdentity('identity-1', { roleId: 'role-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * Phase 11 spec #66 — mandatory role-escalation test: a non-Super-
     * Admin caller (e.g. a Tenant Admin) must never be able to grant
     * SUPER_ADMIN to anyone, including themselves.
     */
    it('blocks granting SUPER_ADMIN when the acting caller is not already SUPER_ADMIN', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        name: 'SUPER_ADMIN',
      });

      await expect(
        service.assignRoleToIdentity(
          'identity-1',
          { roleId: 'role-1' },
          { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.identityRole.upsert).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.role_escalation_blocked',
        }),
      );
    });

    it('allows an existing SUPER_ADMIN to grant SUPER_ADMIN to someone else', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        name: 'SUPER_ADMIN',
      });
      prisma.identityRole.upsert.mockResolvedValue({});

      await service.assignRoleToIdentity(
        'identity-1',
        { roleId: 'role-1' },
        { sub: 'actor-1', roles: ['SUPER_ADMIN'] },
      );

      expect(prisma.identityRole.upsert).toHaveBeenCalled();
    });

    it("allows granting an ordinary role regardless of the acting caller's own roles", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        name: 'STAFF',
      });
      prisma.identityRole.upsert.mockResolvedValue({});

      await service.assignRoleToIdentity(
        'identity-1',
        { roleId: 'role-1' },
        { sub: 'actor-1', roles: ['BRANCH_MANAGER'] },
      );

      expect(prisma.identityRole.upsert).toHaveBeenCalled();
    });
  });

  describe('removeRoleFromIdentity', () => {
    it('blocks removing SUPER_ADMIN when the acting caller is not already SUPER_ADMIN', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        name: 'SUPER_ADMIN',
      });

      await expect(
        service.removeRoleFromIdentity('identity-1', 'role-1', {
          sub: 'actor-1',
          roles: ['COMPANY_ADMIN'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.identityRole.delete).not.toHaveBeenCalled();
    });

    it('allows removing an ordinary role', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'STAFF' });
      prisma.identityRole.delete.mockResolvedValue({});

      await service.removeRoleFromIdentity('identity-1', 'role-1', {
        sub: 'actor-1',
        roles: ['COMPANY_ADMIN'],
      });

      expect(prisma.identityRole.delete).toHaveBeenCalled();
    });
  });
});
