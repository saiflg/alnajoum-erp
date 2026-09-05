import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HotelBookingStatus, PilgrimType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import { RoomAllocationService } from './room-allocation.service';

describe('RoomAllocationService', () => {
  let service: RoomAllocationService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      roomAllocation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      roomAllocationOccupant: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      hotelBooking: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      hajjRegistrationPilgrim: { findMany: jest.fn() },
      umrahRegistrationPilgrim: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomAllocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: PilgrimLookupService,
          useValue: { getPilgrim: jest.fn().mockResolvedValue({ id: 'p1' }) },
        },
      ],
    }).compile();

    service = module.get(RoomAllocationService);
  });

  describe('create (spec #16)', () => {
    it('rejects a room allocation with neither a Hajj nor an Umrah group', async () => {
      await expect(
        service.create({
          hotelName: 'Hilton Makkah',
          roomNumber: '101',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a room allocation referencing both a Hajj and an Umrah group', async () => {
      await expect(
        service.create({
          hajjGroupId: 'hg-1',
          umrahGroupId: 'ug-1',
          hotelName: 'Hilton Makkah',
          roomNumber: '101',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a room with neither a hotelName nor a hotelBookingId', async () => {
      await expect(
        service.create({ hajjGroupId: 'hg-1', roomNumber: '101' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a free-text room as before when no hotelBookingId is given', async () => {
      prisma.roomAllocation.create.mockResolvedValue({ id: 'room-1' });

      await service.create({
        hajjGroupId: 'hg-1',
        hotelName: 'Hilton Makkah',
        roomNumber: '101',
      });

      expect(prisma.roomAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hotelName: 'Hilton Makkah',
            hotelBookingId: undefined,
          }),
        }),
      );
    });

    describe('deeper hotel-catalog integration', () => {
      it('404s when the linked hotelBookingId does not exist', async () => {
        prisma.hotelBooking.findUnique.mockResolvedValue(null);

        await expect(
          service.create({
            hajjGroupId: 'hg-1',
            hotelBookingId: 'missing',
            roomNumber: '101',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.roomAllocation.create).not.toHaveBeenCalled();
      });

      it('snapshots hotelName from the linked booking, overriding any client-sent value', async () => {
        prisma.hotelBooking.findUnique.mockResolvedValue({
          id: 'hb-1',
          hotelName: 'Real Hilton Suites Makkah',
        });
        prisma.roomAllocation.create.mockResolvedValue({ id: 'room-1' });

        await service.create({
          hajjGroupId: 'hg-1',
          hotelBookingId: 'hb-1',
          hotelName: 'Some typo the client sent',
          roomNumber: '412',
        });

        expect(prisma.roomAllocation.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              hotelBookingId: 'hb-1',
              hotelName: 'Real Hilton Suites Makkah',
            }),
          }),
        );
      });
    });
  });

  describe('listLinkableHotelBookings (deeper hotel-catalog integration)', () => {
    it('returns an empty list when the group has no pilgrims, without querying bookings', async () => {
      prisma.hajjRegistrationPilgrim.findMany.mockResolvedValue([]);

      const result = await service.listLinkableHotelBookings(
        PilgrimType.HAJJ,
        'hg-1',
      );

      expect(result).toEqual([]);
      expect(prisma.hotelBooking.findMany).not.toHaveBeenCalled();
    });

    it("queries by the group's pilgrim customer/family-member ids and excludes cancelled/refunded bookings", async () => {
      prisma.hajjRegistrationPilgrim.findMany.mockResolvedValue([
        { customerId: 'cust-1', familyMemberId: null },
        { customerId: null, familyMemberId: 'fm-1' },
      ]);
      prisma.hotelBooking.findMany.mockResolvedValue([{ id: 'hb-1' }]);

      const result = await service.listLinkableHotelBookings(
        PilgrimType.HAJJ,
        'hg-1',
      );

      expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [
                HotelBookingStatus.PENDING,
                HotelBookingStatus.CONFIRMED,
                HotelBookingStatus.COMPLETED,
              ],
            },
          }),
        }),
      );
      expect(result).toEqual([{ id: 'hb-1' }]);
    });
  });

  describe('assignOccupant (spec #16 — capacity conflict prevention)', () => {
    const room = {
      id: 'room-1',
      hajjGroupId: 'hg-1',
      umrahGroupId: null,
      roomNumber: '101',
      capacity: 2,
      occupants: [
        { id: 'occ-1', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p1' },
      ],
    };

    it('refuses to assign once the room is at capacity', async () => {
      prisma.roomAllocation.findUnique.mockResolvedValue({
        ...room,
        occupants: [
          { id: 'occ-1', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p1' },
          { id: 'occ-2', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p2' },
        ],
      });

      await expect(
        service.assignOccupant('room-1', {
          pilgrimType: PilgrimType.HAJJ,
          pilgrimId: 'p3',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.roomAllocationOccupant.create).not.toHaveBeenCalled();
    });

    it('refuses to assign a pilgrim already in another room of the same group', async () => {
      prisma.roomAllocation.findUnique.mockResolvedValue(room);
      prisma.roomAllocation.findMany.mockResolvedValue([
        room,
        {
          id: 'room-2',
          hajjGroupId: 'hg-1',
          umrahGroupId: null,
          roomNumber: '102',
          capacity: 2,
          occupants: [
            { id: 'occ-3', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p3' },
          ],
        },
      ]);

      await expect(
        service.assignOccupant('room-1', {
          pilgrimType: PilgrimType.HAJJ,
          pilgrimId: 'p3',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.roomAllocationOccupant.create).not.toHaveBeenCalled();
    });

    it('assigns a new pilgrim when there is space and they are not already in the group', async () => {
      prisma.roomAllocation.findUnique.mockResolvedValue(room);
      prisma.roomAllocation.findMany.mockResolvedValue([room]);
      prisma.roomAllocationOccupant.create.mockResolvedValue({ id: 'occ-new' });

      const result = await service.assignOccupant('room-1', {
        pilgrimType: PilgrimType.HAJJ,
        pilgrimId: 'p4',
      });

      expect(prisma.roomAllocationOccupant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomAllocationId: 'room-1',
            pilgrimId: 'p4',
          }),
        }),
      );
      expect(result).toEqual({ id: 'occ-new' });
    });
  });

  describe('removeOccupant / checkInOccupant', () => {
    it('404s when the occupant does not belong to this room', async () => {
      prisma.roomAllocationOccupant.findUnique.mockResolvedValue({
        id: 'occ-1',
        roomAllocationId: 'room-2',
      });

      await expect(service.removeOccupant('room-1', 'occ-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.checkInOccupant('room-1', 'occ-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
