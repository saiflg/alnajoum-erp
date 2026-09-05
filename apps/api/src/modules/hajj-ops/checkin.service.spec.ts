import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PilgrimCheckInEvent, PilgrimType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CheckInService } from './checkin.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';

describe('CheckInService', () => {
  let service: CheckInService;
  let prisma: Record<string, any>;
  let pilgrimLookup: {
    getPilgrim: jest.Mock;
    ensurePilgrimCode: jest.Mock;
    findByCode: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      pilgrimCheckIn: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    pilgrimLookup = {
      getPilgrim: jest.fn().mockResolvedValue({ id: 'pilgrim-1' }),
      ensurePilgrimCode: jest.fn(),
      findByCode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckInService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PilgrimLookupService, useValue: pilgrimLookup },
      ],
    }).compile();

    service = module.get(CheckInService);
  });

  describe('getOrCreateQrCode (spec #33 — opaque internal identifier, never sensitive data)', () => {
    it('delegates to PilgrimLookupService.ensurePilgrimCode and returns only the code', async () => {
      pilgrimLookup.ensurePilgrimCode.mockResolvedValue('PLG-ABC123');

      const result = await service.getOrCreateQrCode(
        PilgrimType.HAJJ,
        'pilgrim-1',
      );

      expect(result).toEqual({ pilgrimCode: 'PLG-ABC123' });
      expect(pilgrimLookup.ensurePilgrimCode).toHaveBeenCalledWith(
        PilgrimType.HAJJ,
        'pilgrim-1',
      );
    });
  });

  describe('checkInByCode / recordCheckIn (spec #34 — QR-based check-in)', () => {
    it('resolves the code to a pilgrim and records the check-in event', async () => {
      pilgrimLookup.findByCode.mockResolvedValue({
        pilgrimType: PilgrimType.UMRAH,
        pilgrimId: 'pilgrim-9',
      });
      prisma.pilgrimCheckIn.create.mockResolvedValue({ id: 'checkin-1' });

      await service.checkInByCode(
        'PLG-XYZ789',
        PilgrimCheckInEvent.AIRPORT,
        'staff-1',
        'Terminal 2',
      );

      expect(prisma.pilgrimCheckIn.create).toHaveBeenCalledWith({
        data: {
          pilgrimType: PilgrimType.UMRAH,
          pilgrimId: 'pilgrim-9',
          event: PilgrimCheckInEvent.AIRPORT,
          staffId: 'staff-1',
          location: 'Terminal 2',
        },
      });
    });

    it('404s rather than recording a check-in for a QR code that matches no pilgrim', async () => {
      pilgrimLookup.findByCode.mockRejectedValue(
        new NotFoundException('No pilgrim found for this QR code'),
      );

      await expect(
        service.checkInByCode('BOGUS', PilgrimCheckInEvent.AIRPORT),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.pilgrimCheckIn.create).not.toHaveBeenCalled();
    });

    it('404s a manual check-in for an unknown pilgrim id rather than silently recording it', async () => {
      pilgrimLookup.getPilgrim.mockRejectedValue(
        new NotFoundException('Pilgrim not found'),
      );

      await expect(
        service.recordCheckIn(
          PilgrimType.HAJJ,
          'missing',
          PilgrimCheckInEvent.DEPARTURE,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.pilgrimCheckIn.create).not.toHaveBeenCalled();
    });
  });

  describe('recordCheckIn dedupe (offline outbox replay safety)', () => {
    it('returns the existing row instead of creating a duplicate when the same (pilgrim, event) was recorded within the last 5 minutes', async () => {
      const existing = { id: 'checkin-existing', createdAt: new Date() };
      prisma.pilgrimCheckIn.findFirst.mockResolvedValue(existing);

      const result = await service.recordCheckIn(
        PilgrimType.HAJJ,
        'pilgrim-1',
        PilgrimCheckInEvent.GROUP_CHECK_IN,
        'staff-1',
      );

      expect(result).toBe(existing);
      expect(prisma.pilgrimCheckIn.create).not.toHaveBeenCalled();
    });

    it('creates a new row when no recent (pilgrim, event) check-in exists', async () => {
      prisma.pilgrimCheckIn.findFirst.mockResolvedValue(null);
      prisma.pilgrimCheckIn.create.mockResolvedValue({ id: 'checkin-new' });

      const result = await service.recordCheckIn(
        PilgrimType.HAJJ,
        'pilgrim-1',
        PilgrimCheckInEvent.GROUP_CHECK_IN,
        'staff-1',
      );

      expect(prisma.pilgrimCheckIn.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 'checkin-new' });
    });

    it('only dedupes against the same event type — a different event for the same pilgrim still records', async () => {
      // findFirst is scoped by event in the where clause; a mock that always
      // returns null here (as if the DB found no AIRPORT row while a
      // GROUP_CHECK_IN row exists) proves the query includes `event`, not
      // just `pilgrimId`.
      prisma.pilgrimCheckIn.findFirst.mockResolvedValue(null);
      prisma.pilgrimCheckIn.create.mockResolvedValue({ id: 'checkin-airport' });

      await service.recordCheckIn(
        PilgrimType.HAJJ,
        'pilgrim-1',
        PilgrimCheckInEvent.AIRPORT,
        'staff-1',
      );

      expect(prisma.pilgrimCheckIn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            event: PilgrimCheckInEvent.AIRPORT,
          }),
        }),
      );
      expect(prisma.pilgrimCheckIn.create).toHaveBeenCalled();
    });
  });
});
