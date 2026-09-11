import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPayableStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from './ledger.service';
import { SupplierPayablesService } from './supplier-payables.service';

describe('SupplierPayablesService', () => {
  let service: SupplierPayablesService;
  let prisma: {
    supplierPayable: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    supplierPayment: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let ledger: { post: jest.Mock };

  const outstandingPayable = {
    id: 'payable-1',
    companyId: 'company-a',
    supplierName: 'Air Peace Direct',
    amount: 500_000,
    amountPaid: 0,
    currency: 'NGN',
    payments: [],
  };

  beforeEach(async () => {
    prisma = {
      supplierPayable: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      supplierPayment: { create: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    ledger = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPayablesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(SupplierPayablesService);
  });

  /**
   * Phase 11 spec #2/#65 fix — the mandatory cross-tenant test for the one
   * module left unscoped after the rest of this phase's sweep. companyId
   * is set directly on this model (see FinancePostingService), so this
   * exercises the plain conditional-filter pattern, not a relation join.
   */
  describe('get', () => {
    it('throws NotFound for a payable belonging to a different tenant', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue({
        id: 'payable-1',
        companyId: 'company-b',
      });

      await expect(service.get('payable-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the payable when it belongs to the caller's own tenant", async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue({
        id: 'payable-1',
        companyId: 'company-a',
      });

      await expect(service.get('payable-1', 'company-a')).resolves.toEqual(
        expect.objectContaining({ id: 'payable-1' }),
      );
    });

    it('applies no tenant check when none is given (SUPER_ADMIN)', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue({
        id: 'payable-1',
        companyId: 'company-b',
      });

      await expect(service.get('payable-1')).resolves.toEqual(
        expect.objectContaining({ id: 'payable-1' }),
      );
    });

    it('throws NotFound for a missing payable', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listAll', () => {
    it('scopes by companyId when a tenant filter is given', async () => {
      prisma.supplierPayable.findMany.mockResolvedValue([]);

      await service.listAll({}, 'company-a');

      expect(prisma.supplierPayable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('applies no companyId filter for SUPER_ADMIN', async () => {
      prisma.supplierPayable.findMany.mockResolvedValue([]);

      await service.listAll({});

      const call = prisma.supplierPayable.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('companyId');
    });
  });

  describe('recordPayment', () => {
    it('throws NotFound (via get) before recording a payment on a cross-tenant payable', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue({
        ...outstandingPayable,
        companyId: 'company-b',
      });

      await expect(
        service.recordPayment(
          'payable-1',
          { amount: 100_000, paymentMethod: 'BANK_TRANSFER' },
          'staff-1',
          undefined,
          'company-a',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records the payment and posts the ledger entry for a same-tenant payable', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue(outstandingPayable);
      prisma.supplierPayment.create.mockResolvedValue({ id: 'payment-1' });
      prisma.supplierPayable.update.mockResolvedValue({
        ...outstandingPayable,
        amountPaid: 100_000,
        status: SupplierPayableStatus.PARTIALLY_PAID,
      });

      await service.recordPayment(
        'payable-1',
        { amount: 100_000, paymentMethod: 'BANK_TRANSFER' },
        'staff-1',
        undefined,
        'company-a',
      );

      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100_000 }),
      );
    });

    it('throws BadRequest when the payment exceeds the outstanding balance', async () => {
      prisma.supplierPayable.findUnique.mockResolvedValue(outstandingPayable);

      await expect(
        service.recordPayment(
          'payable-1',
          { amount: 1_000_000, paymentMethod: 'BANK_TRANSFER' },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
