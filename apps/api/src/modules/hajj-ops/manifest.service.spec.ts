import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PilgrimType, ReadinessStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ManifestService } from './manifest.service';
import { ReadinessService } from './readiness.service';

describe('ManifestService (spec #17/#18/#20 — group manifest export)', () => {
  let service: ManifestService;
  let prisma: Record<string, any>;
  let readinessService: { compute: jest.Mock };

  const group = {
    groupNumber: 'HGRP-1',
    name: 'Batch A',
    pilgrims: [
      { id: 'p1', firstName: 'Amina', lastName: 'Yusuf', passportNumber: 'A001', pilgrimCode: 'PLG-1' },
      { id: 'p2', firstName: 'Bilal', lastName: 'Yusuf', passportNumber: null, pilgrimCode: null },
    ],
    roomAllocations: [
      { roomNumber: '101', occupants: [{ pilgrimId: 'p1' }] },
    ],
  };

  beforeEach(async () => {
    prisma = {
      hajjGroup: { findUnique: jest.fn().mockResolvedValue(group) },
      umrahGroup: { findUnique: jest.fn() },
    };
    readinessService = {
      compute: jest.fn().mockResolvedValue({ finalStatus: ReadinessStatus.AMBER }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManifestService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReadinessService, useValue: readinessService },
      ],
    }).compile();

    service = module.get(ManifestService);
  });

  it('404s when the group does not exist', async () => {
    prisma.hajjGroup.findUnique.mockResolvedValue(null);
    await expect(service.renderCsv(PilgrimType.HAJJ, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('includes every pilgrim, their room (or "Unassigned"), and their live readiness in the CSV', async () => {
    const { content, filename } = await service.renderCsv(PilgrimType.HAJJ, 'group-1');

    expect(filename).toBe('manifest-HGRP-1.csv');
    expect(content).toContain('Amina Yusuf,A001,PLG-1,101,AMBER');
    expect(content).toContain('Bilal Yusuf,—,Not generated,Unassigned,AMBER');
  });

  it('never renders a synced readiness field — always calls ReadinessService.compute per pilgrim', async () => {
    await service.renderCsv(PilgrimType.HAJJ, 'group-1');

    expect(readinessService.compute).toHaveBeenCalledWith(PilgrimType.HAJJ, 'p1');
    expect(readinessService.compute).toHaveBeenCalledWith(PilgrimType.HAJJ, 'p2');
  });
});
