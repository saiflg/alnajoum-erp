import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SupplierContractsService } from './supplier-contracts.service';

describe('SupplierContractsService', () => {
  let service: SupplierContractsService;
  let prisma: {
    supplier: { findUnique: jest.Mock };
    supplierContract: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn() },
      supplierContract: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierContractsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(SupplierContractsService);
  });

  describe('create — tenant isolation', () => {
    it('throws NotFound for a cross-tenant supplier before creating a contract', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ companyId: 'company-b' });

      await expect(
        service.create(
          'sup-1',
          { contractNumber: 'SC-1', name: 'Deal', startDate: '2026-01-01' },
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierContract.create).not.toHaveBeenCalled();
    });

    it('creates the contract and audits it when the supplier belongs to this tenant', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ companyId: 'company-a' });
      prisma.supplierContract.create.mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'SC-1',
      });

      await service.create(
        'sup-1',
        { contractNumber: 'SC-1', name: 'Deal', startDate: '2026-01-01' },
        'company-a',
        'identity-1',
      );

      expect(prisma.supplierContract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-1',
            contractNumber: 'SC-1',
          }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'supplier_contract.created' }),
      );
    });
  });

  describe('update — tenant isolation (joined through the parent supplier)', () => {
    it('throws NotFound for a contract whose supplier belongs to a different tenant', async () => {
      prisma.supplierContract.findUnique.mockResolvedValue({
        id: 'contract-1',
        status: 'DRAFT',
        supplier: { companyId: 'company-b' },
      });

      await expect(
        service.update(
          'contract-1',
          { status: 'ACTIVE' },
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierContract.update).not.toHaveBeenCalled();
    });
  });

  describe('listExpiringSoon', () => {
    it('excludes already EXPIRED/TERMINATED contracts and scopes by tenant', async () => {
      prisma.supplierContract.findMany.mockResolvedValue([]);

      await service.listExpiringSoon('company-a');

      const call = prisma.supplierContract.findMany.mock.calls[0][0];
      expect(call.where.status.notIn).toEqual(['EXPIRED', 'TERMINATED']);
      expect(call.where.supplier).toEqual({ companyId: 'company-a' });
    });
  });
});
