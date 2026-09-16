import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let service: CurrencyService;
  let prisma: {
    currency: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      currency: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrencyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(CurrencyService);
  });

  describe('listAll', () => {
    it('filters to active currencies only when asked', async () => {
      prisma.currency.findMany.mockResolvedValue([]);

      await service.listAll(true);

      expect(prisma.currency.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('applies no filter when not asked', async () => {
      prisma.currency.findMany.mockResolvedValue([]);

      await service.listAll(false);

      expect(prisma.currency.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('get', () => {
    it('throws NotFound for an unregistered code', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);

      await expect(service.get('XXX')).rejects.toThrow(NotFoundException);
    });

    it('uppercases the code before looking it up', async () => {
      prisma.currency.findUnique.mockResolvedValue({ code: 'NGN' });

      await service.get('ngn');

      expect(prisma.currency.findUnique).toHaveBeenCalledWith({
        where: { code: 'NGN' },
      });
    });
  });

  describe('create', () => {
    it('throws Conflict when the code is already registered', async () => {
      prisma.currency.findUnique.mockResolvedValue({ code: 'NGN' });

      await expect(
        service.create({ code: 'NGN', name: 'Naira', symbol: '₦' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.currency.create).not.toHaveBeenCalled();
    });

    it('uppercases the code on create', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);
      prisma.currency.create.mockResolvedValue({ code: 'USD' });

      await service.create({ code: 'usd', name: 'US Dollar', symbol: '$' });

      expect(prisma.currency.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'USD' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFound for an unregistered code', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);

      await expect(
        service.update('XXX', { exchangeRateToBase: 1.5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the exchange rate for an existing currency', async () => {
      prisma.currency.findUnique.mockResolvedValue({ code: 'USD' });
      prisma.currency.update.mockResolvedValue({
        code: 'USD',
        exchangeRateToBase: 1600,
      });

      const result = await service.update('usd', { exchangeRateToBase: 1600 });

      expect(prisma.currency.update).toHaveBeenCalledWith({
        where: { code: 'USD' },
        data: { exchangeRateToBase: 1600 },
      });
      expect(result.exchangeRateToBase).toBe(1600);
    });
  });

  describe('convertToBase', () => {
    it('is a no-op for an amount already in NGN, with no lookup at all', async () => {
      const result = await service.convertToBase(50_000, 'NGN');

      expect(result).toEqual({ amount: 50_000, currency: 'NGN' });
      expect(prisma.currency.findUnique).not.toHaveBeenCalled();
    });

    it('is a no-op regardless of the input code casing', async () => {
      const result = await service.convertToBase(50_000, 'ngn');

      expect(result).toEqual({ amount: 50_000, currency: 'NGN' });
    });

    it('converts a non-NGN amount using the currency’s own exchange rate', async () => {
      prisma.currency.findUnique.mockResolvedValue({
        code: 'USD',
        exchangeRateToBase: 1600,
      });

      const result = await service.convertToBase(100, 'usd');

      expect(prisma.currency.findUnique).toHaveBeenCalledWith({
        where: { code: 'USD' },
      });
      expect(result).toEqual({ amount: 160_000, currency: 'NGN' });
    });

    it('rounds to the nearest whole unit', async () => {
      prisma.currency.findUnique.mockResolvedValue({
        code: 'USD',
        exchangeRateToBase: 1599.999,
      });

      const result = await service.convertToBase(1, 'USD');

      expect(result.amount).toBe(1600);
    });

    it('throws NotFound for an unregistered currency code', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);

      await expect(service.convertToBase(100, 'ZZZ')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
