import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      identity: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
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
});
