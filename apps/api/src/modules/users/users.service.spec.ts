import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  const audit = { record: jest.fn() };

  beforeEach(async () => {
    audit.record.mockReset();
    prisma = {
      identity: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn() },
      company: { findUnique: jest.fn() },
      role: { findUnique: jest.fn() },
      rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
      permission: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findUnique: jest.fn() },
      staff: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: { sendStaffTempPassword: jest.fn() },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  /**
   * Phase 11 spec #65 — mandatory cross-tenant tests. Before this fix,
   * `findOne`/`findAll` had no tenant check at all, and `createStaff`
   * trusted a client-supplied companyId outright.
   */
  describe('findOne', () => {
    it("returns the staff record when it belongs to the caller's own tenant", async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 'staff-1',
        companyId: 'company-a',
      });

      await expect(service.findOne('staff-1', 'company-a')).resolves.toEqual(
        expect.objectContaining({ id: 'staff-1' }),
      );
    });

    it('throws NotFound (not the record) for a staff member belonging to a different tenant', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 'staff-1',
        companyId: 'company-b',
      });

      await expect(service.findOne('staff-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the record with no tenant filter (SUPER_ADMIN)', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 'staff-1',
        companyId: 'company-b',
      });

      await expect(service.findOne('staff-1')).resolves.toEqual(
        expect.objectContaining({ id: 'staff-1' }),
      );
    });
  });

  describe('findAll', () => {
    it("scopes the query to the caller's tenant when one is given", async () => {
      prisma.staff.findMany.mockResolvedValue([]);

      await service.findAll(undefined, 'company-a');

      expect(prisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      prisma.staff.findMany.mockResolvedValue([]);

      await service.findAll();

      const call = prisma.staff.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('companyId');
    });
  });

  describe('createStaff', () => {
    it("rejects creating staff in a different company than the caller's own tenant", async () => {
      await expect(
        service.createStaff(
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-b',
            employeeCode: 'EMP1',
            roleId: 'role-1',
          },
          'company-a',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.identity.create).not.toHaveBeenCalled();
    });

    it("allows creating staff within the caller's own company", async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.identity.create.mockResolvedValue({
        id: 'identity-1',
        email: 'a@example.com',
        staff: { id: 'staff-1' },
      });

      await service.createStaff(
        {
          email: 'a@example.com',
          firstName: 'A',
          lastName: 'B',
          companyId: 'company-a',
          employeeCode: 'EMP1',
          roleId: 'role-1',
        },
        'company-a',
        { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
      );

      expect(prisma.identity.create).toHaveBeenCalled();
    });

    it('answers 409 (not a server error) when the employee code is already taken', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.identity.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['employeeCode'] },
        }),
      );

      const attempt = service.createStaff(
        {
          email: 'new@example.com',
          firstName: 'A',
          lastName: 'B',
          companyId: 'company-a',
          employeeCode: 'EMP1',
          roleId: 'role-1',
        },
        'company-a',
        { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
      );
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow(/employee code/);
    });

    it('lets an unexpected database error through unchanged', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.identity.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.createStaff(
          {
            email: 'new@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-a',
            employeeCode: 'EMP2',
            roleId: 'role-1',
          },
          'company-a',
          { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
        ),
      ).rejects.toThrow('connection lost');
    });

    it('refuses to let a company admin create an account holding SUPER_ADMIN', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-sa',
        name: 'SUPER_ADMIN',
      });

      await expect(
        service.createStaff(
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-a',
            employeeCode: 'EMP1',
            roleId: 'role-sa',
          },
          'company-a',
          { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.identity.create).not.toHaveBeenCalled();
    });

    it('refuses a role stronger than the creator holds', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-x',
        name: 'CUSTOM',
      });
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { key: 'company:create' } },
      ]);
      prisma.permission.findMany.mockResolvedValue([{ key: 'staff:create' }]);

      await expect(
        service.createStaff(
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-a',
            employeeCode: 'EMP1',
            roleId: 'role-x',
          },
          'company-a',
          { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.identity.create).not.toHaveBeenCalled();
    });

    it('refuses a branch that belongs to a different company than the new account', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'STAFF' });
      prisma.branch.findUnique.mockResolvedValue({
        id: 'branch-b',
        companyId: 'company-b',
      });

      await expect(
        service.createStaff(
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-a',
            branchId: 'branch-b',
            employeeCode: 'EMP1',
            roleId: 'role-1',
          },
          'company-a',
          { sub: 'actor-1', roles: ['COMPANY_ADMIN'] },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.identity.create).not.toHaveBeenCalled();
    });

    it('refuses a tenant-scoped call that does not say who is creating the account', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'STAFF' });

      await expect(
        service.createStaff(
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            companyId: 'company-a',
            employeeCode: 'EMP1',
            roleId: 'role-1',
          },
          'company-a',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows SUPER_ADMIN (no tenant filter) to create staff for any company', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'company-b' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.identity.create.mockResolvedValue({
        id: 'identity-1',
        email: 'a@example.com',
        staff: { id: 'staff-1' },
      });

      await service.createStaff({
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'B',
        companyId: 'company-b',
        employeeCode: 'EMP1',
        roleId: 'role-1',
      });

      expect(prisma.identity.create).toHaveBeenCalled();
    });
  });

  describe('remove / reactivate', () => {
    const staffRow = {
      id: 'staff-1',
      identityId: 'identity-1',
      companyId: 'company-a',
      employeeCode: 'EMP1',
    };
    const asRoles = (...names: string[]) =>
      prisma.staff.findUnique.mockResolvedValue({
        ...staffRow,
        identity: { roles: names.map((name) => ({ role: { name } })) },
      });
    beforeEach(() => {
      asRoles('STAFF');
    });

    it('deactivates the person, ends their sessions and records who did it', async () => {
      asRoles('STAFF');
      await expect(
        service.remove('staff-1', 'company-a', 'actor-1', 'left the company'),
      ).resolves.toEqual({ removed: true });
      expect(prisma.staff.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { isActive: false },
      });
      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { status: 'DEACTIVATED' },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff.removed',
          entityId: 'staff-1',
          identityId: 'actor-1',
          reason: 'left the company',
        }),
      );
    });

    it('refuses to let someone remove their own account', async () => {
      asRoles('STAFF');
      await expect(
        service.remove('staff-1', 'company-a', 'identity-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('refuses to remove the only active Super Admin', async () => {
      asRoles('SUPER_ADMIN');
      prisma.identity.count.mockResolvedValue(0);
      await expect(
        service.remove('staff-1', undefined, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('allows removing a Super Admin when another one is active', async () => {
      asRoles('SUPER_ADMIN');
      prisma.identity.count.mockResolvedValue(1);
      await expect(
        service.remove('staff-1', undefined, 'actor-1'),
      ).resolves.toEqual({ removed: true });
    });

    it("answers not found for another company's staff member", async () => {
      prisma.staff.findUnique.mockResolvedValue({
        ...staffRow,
        companyId: 'company-b',
        identity: { roles: [] },
      });
      await expect(
        service.remove('staff-1', 'company-a', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('reactivates the person and records it', async () => {
      await expect(
        service.reactivate('staff-1', 'company-a', 'actor-1'),
      ).resolves.toEqual({ reactivated: true });
      expect(prisma.staff.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { isActive: true },
      });
      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { status: 'ACTIVE' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.reactivated' }),
      );
    });
  });

  describe('password reset, transfer and role change', () => {
    const base = {
      id: 'staff-1',
      identityId: 'identity-1',
      companyId: 'company-a',
      branchId: 'branch-1',
      employeeCode: 'EMP1',
      branch: { name: 'Kano' },
    };
    const withRoles = (...names: string[]) =>
      prisma.staff.findUnique.mockResolvedValue({
        ...base,
        identity: {
          email: 'p@example.com',
          roles: names.map((name) => ({ role: { id: `r-${name}`, name } })),
        },
      });
    const admin = { sub: 'actor-1', roles: ['COMPANY_ADMIN'] };
    const superAdmin = { sub: 'actor-1', roles: ['SUPER_ADMIN'] };

    beforeEach(() => {
      (prisma as Record<string, unknown>).$transaction = jest
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.identityRole = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      };
      prisma.refreshToken = { updateMany: jest.fn() };
      withRoles('STAFF');
    });

    describe('resetPassword', () => {
      it('issues a new temporary password, forces a change, clears any lock and ends sessions', async () => {
        const out = await service.resetPassword('staff-1', 'company-a', admin);
        expect(out.temporaryPassword).toMatch(/^Tmp[0-9a-f]{12}!$/);
        const data = prisma.identity.update.mock.calls[0][0].data;
        expect(data).toMatchObject({
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        });
        expect(data.passwordHash).not.toContain(out.temporaryPassword);
        expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
        // the new password is returned once and never written to the audit trail
        expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
          out.temporaryPassword,
        );
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'staff.password_reset' }),
        );
      });

      it('refuses to reset your own password here', async () => {
        await expect(
          service.resetPassword('staff-1', 'company-a', {
            sub: 'identity-1',
            roles: ['COMPANY_ADMIN'],
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.identity.update).not.toHaveBeenCalled();
      });

      it('refuses to reset a Super Admin when you are not one', async () => {
        withRoles('SUPER_ADMIN');
        await expect(
          service.resetPassword('staff-1', 'company-a', admin),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.identity.update).not.toHaveBeenCalled();
      });
    });

    describe('transfer', () => {
      it('moves the person to a branch of their own company and records it', async () => {
        prisma.branch.findUnique.mockResolvedValue({
          id: 'branch-2',
          companyId: 'company-a',
          name: 'Lagos',
        });
        await expect(
          service.transfer(
            'staff-1',
            { branchId: 'branch-2', reason: 'opening Lagos' },
            'company-a',
            admin,
          ),
        ).resolves.toMatchObject({ transferred: true, branchId: 'branch-2' });
        expect(prisma.staff.update).toHaveBeenCalledWith({
          where: { id: 'staff-1' },
          data: { branchId: 'branch-2' },
        });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'staff.transferred',
            reason: 'opening Lagos',
            metadata: expect.objectContaining({
              fromBranch: 'Kano',
              toBranch: 'Lagos',
            }),
          }),
        );
      });

      it('refuses a branch that belongs to another company', async () => {
        prisma.branch.findUnique.mockResolvedValue({
          id: 'branch-x',
          companyId: 'company-b',
          name: 'Elsewhere',
        });
        await expect(
          service.transfer(
            'staff-1',
            { branchId: 'branch-x' },
            'company-a',
            admin,
          ),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.staff.update).not.toHaveBeenCalled();
      });

      it('refuses a move to the branch they are already in, and a self-transfer', async () => {
        await expect(
          service.transfer(
            'staff-1',
            { branchId: 'branch-1' },
            'company-a',
            admin,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.transfer('staff-1', { branchId: null }, 'company-a', {
            sub: 'identity-1',
            roles: ['COMPANY_ADMIN'],
          }),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('changeRole', () => {
      it('promotes: replaces the role, in one step, and records from and to', async () => {
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-BM',
          name: 'BRANCH_MANAGER',
        });
        await expect(
          service.changeRole(
            'staff-1',
            { roleId: 'r-BM', reason: 'promoted' },
            'company-a',
            admin,
          ),
        ).resolves.toEqual({ changed: true, role: 'BRANCH_MANAGER' });
        expect(prisma.identityRole.deleteMany).toHaveBeenCalledWith({
          where: { identityId: 'identity-1' },
        });
        expect(prisma.identityRole.create).toHaveBeenCalledWith({
          data: { identityId: 'identity-1', roleId: 'r-BM' },
        });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'staff.role_changed',
            reason: 'promoted',
            metadata: expect.objectContaining({
              from: ['STAFF'],
              to: 'BRANCH_MANAGER',
            }),
          }),
        );
      });

      it('will not hand out Super Admin unless you are one', async () => {
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-SA',
          name: 'SUPER_ADMIN',
        });
        await expect(
          service.changeRole('staff-1', { roleId: 'r-SA' }, 'company-a', admin),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.identityRole.deleteMany).not.toHaveBeenCalled();
      });

      it('will not let you change someone who already holds a stronger role', async () => {
        withRoles('SUPER_ADMIN');
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-STAFF',
          name: 'STAFF',
        });
        await expect(
          service.changeRole(
            'staff-1',
            { roleId: 'r-STAFF' },
            'company-a',
            admin,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('will not demote the only active Super Admin', async () => {
        withRoles('SUPER_ADMIN');
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-STAFF',
          name: 'STAFF',
        });
        prisma.identity.count.mockResolvedValue(0);
        await expect(
          service.changeRole(
            'staff-1',
            { roleId: 'r-STAFF' },
            undefined,
            superAdmin,
          ),
        ).rejects.toThrow(ConflictException);
        expect(prisma.identityRole.deleteMany).not.toHaveBeenCalled();
      });

      it('refuses the Customer role, a no-op, and changing your own role', async () => {
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-C',
          name: 'CUSTOMER',
        });
        await expect(
          service.changeRole('staff-1', { roleId: 'r-C' }, 'company-a', admin),
        ).rejects.toThrow(BadRequestException);
        prisma.role.findUnique.mockResolvedValue({
          id: 'r-STAFF',
          name: 'STAFF',
        });
        await expect(
          service.changeRole(
            'staff-1',
            { roleId: 'r-STAFF' },
            'company-a',
            admin,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.changeRole('staff-1', { roleId: 'r-STAFF' }, 'company-a', {
            sub: 'identity-1',
            roles: ['COMPANY_ADMIN'],
          }),
        ).rejects.toThrow(ForbiddenException);
      });
    });
  });
});
