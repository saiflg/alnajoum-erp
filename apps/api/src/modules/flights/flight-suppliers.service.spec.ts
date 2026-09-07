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
  });
});
