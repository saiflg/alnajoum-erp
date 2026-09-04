import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PilgrimType } from '@prisma/client';
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomAllocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PilgrimLookupService, useValue: { getPilgrim: jest.fn().mockResolvedValue({ id: 'p1' }) } },
      ],
    }).compile();

    service = module.get(RoomAllocationService);
  });

  describe('create (spec #16)', () => {
    it('rejects a room allocation with neither a Hajj nor an Umrah group', () => {
      expect(() =>
        service.create({ hotelName: 'Hilton Makkah', roomNumber: '101' } as never),
      ).toThrow(BadRequestException);
    });

    it('rejects a room allocation referencing both a Hajj and an Umrah group', () => {
      expect(() =>
        service.create({
          hajjGroupId: 'hg-1',
          umrahGroupId: 'ug-1',
          hotelName: 'Hilton Makkah',
          roomNumber: '101',
        } as never),
      ).toThrow(BadRequestException);
    });
  });

  describe('assignOccupant (spec #16 — capacity conflict prevention)', () => {
    const room = {
      id: 'room-1',
      hajjGroupId: 'hg-1',
      umrahGroupId: null,
      roomNumber: '101',
      capacity: 2,
      occupants: [{ id: 'occ-1', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p1' }],
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
        service.assignOccupant('room-1', { pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p3' }),
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
          occupants: [{ id: 'occ-3', pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p3' }],
        },
      ]);

      await expect(
        service.assignOccupant('room-1', { pilgrimType: PilgrimType.HAJJ, pilgrimId: 'p3' }),
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
          data: expect.objectContaining({ roomAllocationId: 'room-1', pilgrimId: 'p4' }),
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

      await expect(service.removeOccupant('room-1', 'occ-1')).rejects.toThrow(NotFoundException);
      await expect(service.checkInOccupant('room-1', 'occ-1')).rejects.toThrow(NotFoundException);
    });
  });
});
