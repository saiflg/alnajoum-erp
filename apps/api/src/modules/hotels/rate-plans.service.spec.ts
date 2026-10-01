import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RatePlansService } from './rate-plans.service';

describe('RatePlansService', () => {
  let service: RatePlansService;
  let prisma: {
    ratePlan: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    hotelRoomType: { findUnique: jest.Mock };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ratePlan: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      hotelRoomType: { findUnique: jest.fn() },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatePlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(RatePlansService);
  });

  describe('get — tenant isolation', () => {
    it('throws NotFound for a missing rate plan', async () => {
      prisma.ratePlan.findUnique.mockResolvedValue(null);
      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound (not Forbidden) for a cross-tenant rate plan', async () => {
      prisma.ratePlan.findUnique.mockResolvedValue({
        id: 'rp-1',
        companyId: 'company-b',
      });
      await expect(service.get('rp-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the rate plan when it belongs to the caller's own tenant", async () => {
      prisma.ratePlan.findUnique.mockResolvedValue({
        id: 'rp-1',
        companyId: 'company-a',
      });
      await expect(service.get('rp-1', 'company-a')).resolves.toEqual(
        expect.objectContaining({ id: 'rp-1' }),
      );
    });
  });

  describe('create', () => {
    it('throws NotFound when the room type does not exist', async () => {
      prisma.hotelRoomType.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          {
            roomTypeId: 'rt-missing',
            name: 'Corporate rate',
            netPrice: 20_000,
            effectiveFrom: '2026-10-01',
          },
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.ratePlan.create).not.toHaveBeenCalled();
    });

    it('attributes the new rate plan to the given company and audits it', async () => {
      prisma.hotelRoomType.findUnique.mockResolvedValue({ id: 'rt-1' });
      prisma.ratePlan.create.mockResolvedValue({
        id: 'rp-1',
        name: 'Corporate rate',
        netPrice: 20_000,
      });

      await service.create(
        {
          roomTypeId: 'rt-1',
          name: 'Corporate rate',
          netPrice: 20_000,
          effectiveFrom: '2026-10-01',
        },
        'company-a',
        'identity-1',
      );

      expect(prisma.ratePlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-a',
          roomTypeId: 'rt-1',
        }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'rate_plan.created' }),
      );
    });
  });

  describe('findApplicable', () => {
    it('queries for an active plan covering the full stay window, most recent first', async () => {
      prisma.ratePlan.findFirst.mockResolvedValue(null);

      await service.findApplicable(
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-05',
      );

      expect(prisma.ratePlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company-a',
            roomTypeId: 'rt-1',
            isActive: true,
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('returns null when no plan covers the stay', async () => {
      prisma.ratePlan.findFirst.mockResolvedValue(null);
      const result = await service.findApplicable(
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-05',
      );
      expect(result).toBeNull();
    });
  });
});
