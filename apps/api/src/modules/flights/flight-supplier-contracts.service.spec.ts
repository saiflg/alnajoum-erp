import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightSupplierContractStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightSupplierContractsService } from './flight-supplier-contracts.service';

describe('FlightSupplierContractsService', () => {
  let service: FlightSupplierContractsService;
  let prisma: {
    flightSupplier: { findUnique: jest.Mock };
    flightSupplierContract: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      flightSupplier: { findUnique: jest.fn() },
      flightSupplierContract: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightSupplierContractsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FlightSupplierContractsService);
  });

  describe('create', () => {
    it('throws NotFound when the supplier does not exist', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing', { name: 'Deal', startDate: '2026-01-01' }),
      ).rejects.toThrow(NotFoundException);
    });

    /** Phase 11 spec #2/#65 fix — a contract has no companyId of its own;
     * ownership is checked by joining through the parent supplier. */
    it('throws NotFound when the supplier belongs to a different tenant', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
      });

      await expect(
        service.create(
          'sup-1',
          { name: 'Deal', startDate: '2026-01-01' },
          'company-a',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.flightSupplierContract.create).not.toHaveBeenCalled();
    });

    it('creates the contract with dates parsed from ISO strings', async () => {
      prisma.flightSupplier.findUnique.mockResolvedValue({ id: 'sup-1' });
      prisma.flightSupplierContract.create.mockResolvedValue({
        id: 'contract-1',
      });

      await service.create('sup-1', {
        name: '2026 Deal',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      expect(prisma.flightSupplierContract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierId: 'sup-1',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      });
    });
  });

  describe('update', () => {
    it('throws NotFound for a missing contract', async () => {
      prisma.flightSupplierContract.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFound when the contract's supplier belongs to a different tenant", async () => {
      prisma.flightSupplierContract.findUnique.mockResolvedValue({
        id: 'contract-1',
        supplier: { companyId: 'company-b' },
      });

      await expect(
        service.update('contract-1', {}, 'company-a'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.flightSupplierContract.update).not.toHaveBeenCalled();
    });
  });

  describe('listExpiringSoon', () => {
    it('excludes already-EXPIRED/TERMINATED contracts from the query', async () => {
      prisma.flightSupplierContract.findMany.mockResolvedValue([]);

      await service.listExpiringSoon();

      expect(prisma.flightSupplierContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({
              notIn: [
                FlightSupplierContractStatus.EXPIRED,
                FlightSupplierContractStatus.TERMINATED,
              ],
            }),
          }),
        }),
      );
    });

    it('scopes by the supplier relation when a tenant filter is given', async () => {
      prisma.flightSupplierContract.findMany.mockResolvedValue([]);

      await service.listExpiringSoon('company-a');

      expect(prisma.flightSupplierContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supplier: { companyId: 'company-a' },
          }),
        }),
      );
    });
  });
});
