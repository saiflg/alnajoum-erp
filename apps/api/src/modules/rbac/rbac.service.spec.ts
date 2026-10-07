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
      rolePermission: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      identity: { findFirst: jest.fn() },
      branch: { findFirst: jest.fn() },
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

    describe('as a tenant admin (Phase 22 S-06/S-07)', () => {
      const actor = {
        sub: 'actor-1',
        roles: ['COMPANY_ADMIN'],
        companyId: 'company-1',
      };

      beforeEach(() => {
        prisma.role.findUnique.mockResolvedValue({
          id: 'role-1',
          name: 'STAFF',
        });
        prisma.identity.findFirst.mockResolvedValue({ id: 'identity-1' });
        prisma.rolePermission.findMany.mockResolvedValue([
          { permission: { key: 'customer:read' } },
        ]);
        prisma.permission.findMany.mockResolvedValue([
          { key: 'customer:read' },
          { key: 'customer:update' },
        ]);
        prisma.identityRole.upsert.mockResolvedValue({});
      });

      it('grants an ordinary role the caller already has the permissions for, recorded against their company', async () => {
        await service.assignRoleToIdentity(
          'identity-1',
          { roleId: 'role-1', companyId: 'company-OTHER' },
          actor,
        );

        const args = prisma.identityRole.upsert.mock.calls[0][0] as {
          create: { companyId: string };
          update: { companyId: string };
        };
        expect(args.create.companyId).toBe('company-1');
        expect(args.update.companyId).toBe('company-1');
      });

      it("will not touch an identity outside the caller's company", async () => {
        prisma.identity.findFirst.mockResolvedValue(null);

        await expect(
          service.assignRoleToIdentity(
            'identity-x',
            { roleId: 'role-1' },
            actor,
          ),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.identityRole.upsert).not.toHaveBeenCalled();
        expect(prisma.identity.findFirst.mock.calls[0][0].where).toEqual({
          id: 'identity-x',
          OR: [
            { customer: { companyId: 'company-1' } },
            { staff: { companyId: 'company-1' } },
          ],
        });
      });

      it('refuses a role carrying permissions the caller does not hold (privilege ceiling)', async () => {
        prisma.rolePermission.findMany.mockResolvedValue([
          { permission: { key: 'customer:read' } },
          { permission: { key: 'company:create' } },
        ]);

        await expect(
          service.assignRoleToIdentity(
            'identity-1',
            { roleId: 'role-1' },
            actor,
          ),
        ).rejects.toThrow(/company:create/);
        expect(prisma.identityRole.upsert).not.toHaveBeenCalled();
      });

      it('refuses a branch that belongs to another company', async () => {
        prisma.branch.findFirst.mockResolvedValue(null);

        await expect(
          service.assignRoleToIdentity(
            'identity-1',
            { roleId: 'role-1', branchId: 'branch-x' },
            actor,
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('a caller with no company is confined to nothing, not everything', async () => {
        prisma.identity.findFirst.mockResolvedValue(null);

        await expect(
          service.assignRoleToIdentity(
            'identity-1',
            { roleId: 'role-1' },
            { ...actor, companyId: null },
          ),
        ).rejects.toThrow(NotFoundException);
        expect(
          JSON.stringify(prisma.identity.findFirst.mock.calls[0][0]),
        ).toContain('__no_tenant__');
      });
    });

    it('lets a SUPER_ADMIN grant any role to any identity without tenant or ceiling checks', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        name: 'COMPANY_ADMIN',
      });
      prisma.identityRole.upsert.mockResolvedValue({});

      await service.assignRoleToIdentity(
        'identity-1',
        { roleId: 'role-1', companyId: 'company-9' },
        { sub: 'root', roles: ['SUPER_ADMIN'] },
      );

      expect(prisma.identity.findFirst).not.toHaveBeenCalled();
      expect(prisma.identityRole.upsert.mock.calls[0][0].create.companyId).toBe(
        'company-9',
      );
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

    it("allows removing an ordinary role from an identity in the caller's own company", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'STAFF' });
      prisma.identity.findFirst.mockResolvedValue({ id: 'identity-1' });
      prisma.identityRole.delete.mockResolvedValue({});

      await service.removeRoleFromIdentity('identity-1', 'role-1', {
        sub: 'actor-1',
        roles: ['COMPANY_ADMIN'],
        companyId: 'company-1',
      });

      expect(prisma.identityRole.delete).toHaveBeenCalled();
    });

    it('will not strip a role from an identity in another company', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'STAFF' });
      prisma.identity.findFirst.mockResolvedValue(null);

      await expect(
        service.removeRoleFromIdentity('identity-x', 'role-1', {
          sub: 'actor-1',
          roles: ['COMPANY_ADMIN'],
          companyId: 'company-1',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.identityRole.delete).not.toHaveBeenCalled();
    });
  });
});
