import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VisaServiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { computeMargin, VisaServicesService } from './visa-services.service';

describe('computeMargin (pure)', () => {
  it('is selling price minus company cost — the spec example exactly', () => {
    expect(computeMargin(600_000, 800_000)).toBe(200_000);
  });

  it('can be negative (selling below cost is a real, visible condition, not hidden)', () => {
    expect(computeMargin(800_000, 600_000)).toBe(-200_000);
  });
});

describe('VisaServicesService', () => {
  let service: VisaServicesService;
  let prisma: {
    visaService: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      visaService: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaServicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(VisaServicesService);
  });

  describe('create', () => {
    it('generates a serviceCode, persists the entry, audits it, and returns the computed margin', async () => {
      prisma.visaService.create.mockResolvedValue({
        id: 'vs-1',
        serviceCode: 'VS-ABCD1234',
        companyCost: 600_000,
        sellingPrice: 800_000,
      });

      const result = await service.create(
        {
          country: 'Saudi Arabia',
          visaType: 'Pilgrimage',
          companyCost: 600_000,
          sellingPrice: 800_000,
        },
        'identity-1',
      );

      expect(prisma.visaService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            country: 'Saudi Arabia',
            companyCost: 600_000,
            sellingPrice: 800_000,
            serviceCode: expect.stringMatching(/^VS-[0-9A-F]{8}$/),
          }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_service.created' }),
      );
      expect(result.margin).toBe(200_000);
    });
  });

  describe('update', () => {
    it('records before/after cost and status in the audit entry', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        id: 'vs-1',
        companyCost: 600_000,
        sellingPrice: 800_000,
        status: VisaServiceStatus.DRAFT,
      });
      prisma.visaService.update.mockResolvedValue({
        id: 'vs-1',
        companyCost: 600_000,
        sellingPrice: 850_000,
        status: VisaServiceStatus.ACTIVE,
      });

      const result = await service.update('vs-1', { sellingPrice: 850_000, status: VisaServiceStatus.ACTIVE }, 'identity-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            previous: { companyCost: 600_000, sellingPrice: 800_000, status: VisaServiceStatus.DRAFT },
            next: { companyCost: 600_000, sellingPrice: 850_000, status: VisaServiceStatus.ACTIVE },
          },
        }),
      );
      expect(result.margin).toBe(250_000);
    });

    it('throws NotFound when updating a service that does not exist', async () => {
      prisma.visaService.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { sellingPrice: 1 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('get', () => {
    it('throws NotFound for a missing service', async () => {
      prisma.visaService.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the service with its computed margin', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        id: 'vs-1',
        companyCost: 600_000,
        sellingPrice: 800_000,
      });

      const result = await service.get('vs-1');

      expect(result.margin).toBe(200_000);
    });
  });
});
