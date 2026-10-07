import { NotFoundException } from '@nestjs/common';
import { CompanyService } from '../company/company.service';
import { BranchService } from './branch.service';

describe('Company / branch tenancy (Phase 22 S-10)', () => {
  const prisma = {
    company: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    branch: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const branches = new BranchService(prisma as never);
  const companies = new CompanyService(prisma as never);

  beforeEach(() => jest.resetAllMocks());

  describe('branches', () => {
    it("refuses to create a branch under another tenant's company", async () => {
      await expect(
        branches.create(
          { companyId: 'company-2', code: 'X', name: 'X' },
          'company-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.branch.create).not.toHaveBeenCalled();
    });

    it("allows a branch under the tenant's own company", async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'company-1' });
      prisma.branch.findUnique.mockResolvedValue(null);
      prisma.branch.create.mockResolvedValue({ id: 'b1' });
      await branches.create(
        { companyId: 'company-1', code: 'X', name: 'X' },
        'company-1',
      );
      expect(prisma.branch.create).toHaveBeenCalled();
    });

    it("pins the list to the caller's company whatever companyId they pass", async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      await branches.findAll('company-2', 'company-1');
      expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({
        companyId: 'company-1',
      });
    });

    it('SUPER_ADMIN may filter by any company or none', async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      await branches.findAll('company-2', undefined);
      expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({
        companyId: 'company-2',
      });
      await branches.findAll(undefined, undefined);
      expect(prisma.branch.findMany.mock.calls[1][0].where).toBeUndefined();
    });

    it("another tenant's branch is NotFound for read, update and delete", async () => {
      prisma.branch.findFirst.mockResolvedValue(null);
      await expect(branches.findOne('b2', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(branches.update('b2', {}, 'company-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(branches.remove('b2', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.branch.update).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst.mock.calls[0][0].where).toEqual({
        id: 'b2',
        companyId: 'company-1',
      });
    });

    it('branch detail never selects staff bank details', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1' });
      await branches.findOne('b1', 'company-1');
      const staff = prisma.branch.findFirst.mock.calls[0][0].include.staff;
      expect(staff.select).toBeDefined();
      expect(Object.keys(staff.select).join(',')).not.toMatch(/bank/i);
    });
  });

  describe('companies', () => {
    it("lists only the caller's own company", async () => {
      prisma.company.findMany.mockResolvedValue([]);
      await companies.findAll('company-1');
      expect(prisma.company.findMany.mock.calls[0][0].where).toEqual({
        id: 'company-1',
      });
      await companies.findAll(undefined);
      expect(prisma.company.findMany.mock.calls[1][0].where).toBeUndefined();
    });

    it("another tenant's company is NotFound for read and update, without touching the database", async () => {
      await expect(companies.findOne('company-2', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        companies.update('company-2', {}, 'company-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('a tenant can read and update its own company', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-1',
        branches: [],
      });
      prisma.company.update.mockResolvedValue({ id: 'company-1' });
      await expect(
        companies.update('company-1', { name: 'N' }, 'company-1'),
      ).resolves.toBeDefined();
    });
  });
});
