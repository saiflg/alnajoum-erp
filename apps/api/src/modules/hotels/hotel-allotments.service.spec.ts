import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HotelAllotmentsService } from './hotel-allotments.service';

jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_HOUR: 'EVERY_HOUR' },
}));

describe('HotelAllotmentsService', () => {
  let service: HotelAllotmentsService;
  let prisma: {
    hotelAllotment: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    hotelRoomType: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      hotelAllotment: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      hotelRoomType: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      $executeRaw: jest.fn(),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelAllotmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(HotelAllotmentsService);
  });

  describe('create', () => {
    it('throws NotFound when the room type does not exist', async () => {
      prisma.hotelRoomType.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          { roomTypeId: 'rt-missing', date: '2026-11-01', totalAllocated: 5 },
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.hotelAllotment.upsert).not.toHaveBeenCalled();
    });

    it('upserts the row keyed on companyId/roomTypeId/date and audits it', async () => {
      prisma.hotelRoomType.findUnique.mockResolvedValue({ id: 'rt-1' });
      prisma.hotelAllotment.upsert.mockResolvedValue({ id: 'ha-1' });

      await service.create(
        { roomTypeId: 'rt-1', date: '2026-11-01', totalAllocated: 5 },
        'company-a',
        'identity-1',
      );

      expect(prisma.hotelAllotment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_roomTypeId_date: {
              companyId: 'company-a',
              roomTypeId: 'rt-1',
              date: new Date('2026-11-01'),
            },
          },
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'hotel_allotment.created' }),
      );
    });
  });

  describe('bulkCreate', () => {
    it('upserts one row per day in the inclusive range', async () => {
      prisma.hotelRoomType.findUnique.mockResolvedValue({ id: 'rt-1' });
      prisma.hotelAllotment.upsert.mockResolvedValue({ id: 'ha-x' });

      await service.bulkCreate(
        {
          roomTypeId: 'rt-1',
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          totalAllocated: 10,
        },
        'company-a',
        'identity-1',
      );

      expect(prisma.hotelAllotment.upsert).toHaveBeenCalledTimes(3);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel_allotment.bulk_created',
          metadata: expect.objectContaining({ days: 3 }),
        }),
      );
    });
  });

  describe('claimNights', () => {
    const tx = () => ({
      hotelAllotment: { count: jest.fn() },
      $executeRaw: jest.fn(),
    });

    it('returns false (unmanaged) when not every night has an allotment row', async () => {
      const txClient = tx();
      txClient.hotelAllotment.count.mockResolvedValue(1); // 1 of 2 nights managed

      const claimed = await service.claimNights(
        txClient as never,
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-03', // 2 nights
        1,
      );

      expect(claimed).toBe(false);
      expect(txClient.$executeRaw).not.toHaveBeenCalled();
    });

    it('claims atomically when every night is managed and capacity allows', async () => {
      const txClient = tx();
      txClient.hotelAllotment.count.mockResolvedValue(2);
      txClient.$executeRaw.mockResolvedValue(2);

      const claimed = await service.claimNights(
        txClient as never,
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-03',
        1,
      );

      expect(claimed).toBe(true);
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('throws Conflict when a race consumes capacity between the count and the update', async () => {
      const txClient = tx();
      txClient.hotelAllotment.count.mockResolvedValue(2);
      txClient.$executeRaw.mockResolvedValue(1); // only 1 of 2 rows actually updated

      await expect(
        service.claimNights(
          txClient as never,
          'company-a',
          'rt-1',
          '2026-11-01',
          '2026-11-03',
          1,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('returns false for a zero-night range without touching the database', async () => {
      const txClient = tx();
      const claimed = await service.claimNights(
        txClient as never,
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-01',
        1,
      );
      expect(claimed).toBe(false);
      expect(txClient.hotelAllotment.count).not.toHaveBeenCalled();
    });
  });

  describe('releaseNights', () => {
    it('issues one decrement update across the whole stay range', async () => {
      prisma.$executeRaw.mockResolvedValue(2);

      await service.releaseNights(
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-03',
        1,
      );

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a zero-night range', async () => {
      await service.releaseNights(
        'company-a',
        'rt-1',
        '2026-11-01',
        '2026-11-01',
        1,
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('runAutoReleaseSweep', () => {
    it('stops sell on rows past their release date and marks them auto-released', async () => {
      prisma.hotelAllotment.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.runAutoReleaseSweep();

      expect(prisma.hotelAllotment.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          autoReleased: false,
          stopSell: false,
        }),
        data: { stopSell: true, autoReleased: true },
      });
      expect(result).toEqual({ released: 3 });
    });
  });
});
