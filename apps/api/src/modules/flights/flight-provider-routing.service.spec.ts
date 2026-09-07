import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightProviderName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightProviderRoutingService } from './flight-provider-routing.service';

describe('FlightProviderRoutingService', () => {
  let service: FlightProviderRoutingService;
  let prisma: {
    flightProviderRoutingRule: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      flightProviderRoutingRule: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightProviderRoutingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FlightProviderRoutingService);
  });

  describe('resolveOrder', () => {
    it('returns [] (no fallback configured) when no rule exists', async () => {
      prisma.flightProviderRoutingRule.findMany.mockResolvedValue([]);

      await expect(service.resolveOrder('LOS', 'DXB')).resolves.toEqual([]);
    });

    it('an exact-route rule beats a fully-global rule', async () => {
      prisma.flightProviderRoutingRule.findMany.mockResolvedValue([
        {
          origin: null,
          destination: null,
          providerPriority: ['MOCK'],
        },
        {
          origin: 'LOS',
          destination: 'DXB',
          providerPriority: ['DUFFEL', 'TRAVELPORT', 'SABRE'],
        },
      ]);

      const result = await service.resolveOrder('LOS', 'DXB');

      expect(result).toEqual([
        FlightProviderName.DUFFEL,
        FlightProviderName.TRAVELPORT,
        FlightProviderName.SABRE,
      ]);
    });

    it('falls back to the global rule when no route-specific rule matches this route', async () => {
      prisma.flightProviderRoutingRule.findMany.mockResolvedValue([
        { origin: null, destination: null, providerPriority: ['MOCK'] },
        {
          origin: 'LOS',
          destination: 'JED',
          providerPriority: ['DUFFEL'],
        },
      ]);

      const result = await service.resolveOrder('LOS', 'DXB'); // different destination

      expect(result).toEqual([FlightProviderName.MOCK]);
    });

    it('an origin-only rule matches any destination from that origin', async () => {
      prisma.flightProviderRoutingRule.findMany.mockResolvedValue([
        { origin: 'LOS', destination: null, providerPriority: ['DUFFEL'] },
      ]);

      await expect(service.resolveOrder('LOS', 'RUH')).resolves.toEqual([
        FlightProviderName.DUFFEL,
      ]);
    });
  });

  describe('update/delete', () => {
    it('throws NotFound when updating a missing rule', async () => {
      prisma.flightProviderRoutingRule.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
