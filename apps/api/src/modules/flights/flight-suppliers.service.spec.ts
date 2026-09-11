import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightSuppliersService } from './flight-suppliers.service';

describe('FlightSuppliersService', () => {
  let service: FlightSuppliersService;
  let prisma: {
    flightSupplier: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    supplierPayable: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      flightSupplier: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      supplierPayable: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightSuppliersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FlightSuppliersService);
  });

  describe('get', () => {
    it('throws NotFound for a missing supplier', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });

    /**
     * Phase 11 spec #2/#65 fix — a supplier's negotiated commission/markup/
     * credit terms are commercially sensitive per-tenant data; this is the
     * mandatory cross-tenant test for the one module left unscoped after
     * the rest of this phase's sweep.
     */
    it('throws NotFound for a supplier belonging to a different tenant', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(service.get('sup-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the supplier when it belongs to the caller's own tenant", async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
      });

      await expect(service.get('sup-1', 'company-a')).resolves.toEqual(
        expect.objectContaining({ id: 'sup-1' }),
      );
    });

    it('applies no tenant check when none is given (SUPER_ADMIN)', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(service.get('sup-1')).resolves.toEqual(
        expect.objectContaining({ id: 'sup-1' }),
      );
    });
  });

  describe('listAll', () => {
    it('scopes by companyId when a tenant filter is given', async () => {
      prisma.flightSupplier.findMany.mockResolvedValue([]);

      await service.listAll({}, 'company-a');

      expect(prisma.flightSupplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('applies no companyId filter for SUPER_ADMIN', async () => {
      prisma.flightSupplier.findMany.mockResolvedValue([]);

      await service.listAll({});

      const call = prisma.flightSupplier.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('companyId');
    });
  });

  describe('create', () => {
    it('attributes the new supplier to the given company', async () => {
      prisma.flightSupplier.create.mockResolvedValue({ id: 'sup-1' });

      await service.create(
        { name: 'New Supplier', type: 'AIRLINE' },
        'company-a',
      );

      expect(prisma.flightSupplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-a' }),
      });
    });
  });

  describe('getBalance', () => {
    it('sums payables/payments across every linked SupplierPayable', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
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

    it("spec #23's own worked example: 8.9M exposure against a 10M limit fires the 85% alert", async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        creditLimit: 10_000_000,
      });
      prisma.supplierPayable.findMany.mockResolvedValue([
        { amount: 8_900_000, amountPaid: 0 },
      ]);

      const balance = await service.getBalance('sup-1');

      expect(balance.currentBalance).toBe(8_900_000);
      expect(balance.availableCredit).toBe(1_100_000);
      expect(balance.utilization).toBeCloseTo(0.89);
      expect(balance.alert).toContain('above the 85% alert threshold');
    });

    it('does not alert when utilization is below the threshold', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
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
      prisma.flightSupplier.findUnique.mockResolvedValue({
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
