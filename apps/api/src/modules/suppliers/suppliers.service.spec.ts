import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: {
    supplier: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    supplierPayable: { findMany: jest.Mock };
    supplierContact: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      supplier: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      supplierPayable: { findMany: jest.fn() },
      supplierContact: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(SuppliersService);
  });

  describe('get — tenant isolation (spec #50, tested explicitly)', () => {
    it('throws NotFound for a missing supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound (not Forbidden) for a supplier belonging to a different tenant — indistinguishable from missing', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(service.get('sup-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the supplier when it belongs to the caller's own tenant", async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
      });

      await expect(service.get('sup-1', 'company-a')).resolves.toEqual(
        expect.objectContaining({ id: 'sup-1' }),
      );
    });

    it('applies no tenant check when none is given (SUPER_ADMIN)', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(service.get('sup-1')).resolves.toEqual(
        expect.objectContaining({ id: 'sup-1' }),
      );
    });
  });

  describe('list', () => {
    it('scopes by companyId when a tenant filter is given', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);

      await service.list({}, 'company-a');

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('applies no companyId filter for SUPER_ADMIN', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);

      await service.list({});

      const call = prisma.supplier.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('companyId');
    });
  });

  describe('create', () => {
    it('attributes the new supplier to the given company and audits it', async () => {
      prisma.supplier.create.mockResolvedValue({
        id: 'sup-1',
        legalName: 'Acme Hotels',
        type: 'HOTEL',
      });

      await service.create(
        { legalName: 'Acme Hotels', type: 'HOTEL' },
        'company-a',
        'identity-1',
      );

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-a' }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'supplier.created' }),
      );
    });
  });

  describe('addContact / removeContact — tenant isolation', () => {
    it('addContact throws NotFound for a cross-tenant supplier before creating anything', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(
        service.addContact(
          'sup-1',
          { name: 'Jane' },
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierContact.create).not.toHaveBeenCalled();
    });

    it('removeContact throws NotFound when the contact belongs to a different supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
      });
      prisma.supplierContact.findUnique.mockResolvedValue({
        id: 'contact-1',
        supplierId: 'sup-OTHER',
      });

      await expect(
        service.removeContact('sup-1', 'contact-1', 'company-a', 'identity-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierContact.delete).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('sums payables/payments across every linked SupplierPayable', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        creditLimit: null,
      });
      prisma.supplierPayable.findMany.mockResolvedValue([
        { amount: 500_000, amountPaid: 200_000 },
        { amount: 300_000, amountPaid: 300_000 },
      ]);

      const balance = await service.getBalance('sup-1');

      expect(balance.totalPayable).toBe(800_000);
      expect(balance.totalPaid).toBe(500_000);
      expect(balance.currentBalance).toBe(300_000);
      expect(balance.utilization).toBeNull();
      expect(balance.alert).toBeNull();
    });

    it('fires the 85% credit-utilization alert (spec #23/#30 worked example)', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        creditLimit: 10_000_000,
      });
      prisma.supplierPayable.findMany.mockResolvedValue([
        { amount: 8_900_000, amountPaid: 0 },
      ]);

      const balance = await service.getBalance('sup-1');

      expect(balance.availableCredit).toBe(1_100_000);
      expect(balance.utilization).toBeCloseTo(0.89);
      expect(balance.alert).toContain('above the 85% alert threshold');
    });

    it('does not alert when utilization is below the threshold', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        creditLimit: 10_000_000,
      });
      prisma.supplierPayable.findMany.mockResolvedValue([
        { amount: 1_000_000, amountPaid: 0 },
      ]);

      const balance = await service.getBalance('sup-1');

      expect(balance.alert).toBeNull();
    });

    it('throws NotFound (via get) for a cross-tenant supplier before touching any payables', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(service.getBalance('sup-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.supplierPayable.findMany).not.toHaveBeenCalled();
    });
  });
});
