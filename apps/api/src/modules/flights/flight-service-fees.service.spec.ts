import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightServiceFeeType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightServiceFeesService } from './flight-service-fees.service';

describe('FlightServiceFeesService', () => {
  let service: FlightServiceFeesService;
  let prisma: {
    flightServiceFee: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      flightServiceFee: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightServiceFeesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FlightServiceFeesService);
  });

  describe('resolve', () => {
    it('returns 0 when no active fee is configured for this type', async () => {
      prisma.flightServiceFee.findFirst.mockResolvedValue(null);

      await expect(
        service.resolve(FlightServiceFeeType.TICKETING, 500_000),
      ).resolves.toBe(0);
    });

    it('a flat amount takes priority over percent', async () => {
      prisma.flightServiceFee.findFirst.mockResolvedValue({
        amount: 2_000,
        percent: 5,
      });

      await expect(
        service.resolve(FlightServiceFeeType.TICKETING, 500_000),
      ).resolves.toBe(2_000);
    });

    it('computes a percentage fee against the base amount', async () => {
      prisma.flightServiceFee.findFirst.mockResolvedValue({
        amount: null,
        percent: 2,
      });

      await expect(
        service.resolve(FlightServiceFeeType.CANCELLATION, 500_000),
      ).resolves.toBe(10_000);
    });

    it('returns 0 when the fee has neither amount nor percent set', async () => {
      prisma.flightServiceFee.findFirst.mockResolvedValue({
        amount: null,
        percent: null,
      });

      await expect(
        service.resolve(FlightServiceFeeType.BOOKING, 500_000),
      ).resolves.toBe(0);
    });
  });

  describe('update/delete', () => {
    it('throws NotFound when updating a missing fee', async () => {
      prisma.flightServiceFee.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFound when deleting a missing fee', async () => {
      prisma.flightServiceFee.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
