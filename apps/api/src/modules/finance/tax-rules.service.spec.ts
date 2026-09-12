import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TaxRulesService } from './tax-rules.service';

describe('TaxRulesService', () => {
  let service: TaxRulesService;
  let prisma: {
    taxRule: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      taxRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(TaxRulesService);
  });

  describe('listAll', () => {
    it('passes through the applicableService/country/isActive filters', async () => {
      prisma.taxRule.findMany.mockResolvedValue([]);

      await service.listAll({
        applicableService: 'FLIGHT',
        country: 'NG',
        isActive: true,
      });

      expect(prisma.taxRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { applicableService: 'FLIGHT', country: 'NG', isActive: true },
        }),
      );
    });
  });

  describe('get', () => {
    it('throws NotFound for a missing rule', async () => {
      prisma.taxRule.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('parses effectiveFrom/effectiveTo from ISO strings', async () => {
      prisma.taxRule.create.mockResolvedValue({ id: 'rule-1' });

      await service.create({
        name: 'Nigeria VAT',
        ratePercent: 7.5,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      expect(prisma.taxRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Nigeria VAT',
          ratePercent: 7.5,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'),
        }),
      });
    });
  });

  describe('update', () => {
    it('throws NotFound for a missing rule', async () => {
      prisma.taxRule.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.taxRule.update).not.toHaveBeenCalled();
    });

    it('updates an existing rule', async () => {
      prisma.taxRule.findUnique.mockResolvedValue({ id: 'rule-1' });
      prisma.taxRule.update.mockResolvedValue({
        id: 'rule-1',
        isActive: false,
      });

      const result = await service.update('rule-1', { isActive: false });

      expect(prisma.taxRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rule-1' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(result.isActive).toBe(false);
    });
  });
});
