import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HajjGroupsService } from './hajj-groups.service';

describe('HajjGroupsService', () => {
  let service: HajjGroupsService;
  let prisma: Record<string, any>;

  const group = {
    id: 'group-1',
    maxCapacity: 2,
    package: {},
    coordinatorStaff: null,
    pilgrims: [],
    transports: [],
  };

  beforeEach(async () => {
    prisma = {
      hajjGroup: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(group),
        update: jest.fn(),
      },
      hajjRegistrationPilgrim: {
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HajjGroupsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(HajjGroupsService);
  });

  describe('assignPilgrim (spec #4 — group assignment without duplicating the customer/family record)', () => {
    it('assigns an existing pilgrim to the group by setting groupId, never creating a new pilgrim row', async () => {
      prisma.hajjRegistrationPilgrim.findUnique.mockResolvedValue({
        id: 'p1',
        groupId: null,
      });
      prisma.hajjRegistrationPilgrim.count.mockResolvedValue(0);
      prisma.hajjRegistrationPilgrim.update.mockResolvedValue({
        id: 'p1',
        groupId: 'group-1',
      });

      await service.assignPilgrim('group-1', 'p1');

      expect(prisma.hajjRegistrationPilgrim.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { groupId: 'group-1' },
      });
    });

    it('refuses to assign past maxCapacity', async () => {
      prisma.hajjRegistrationPilgrim.findUnique.mockResolvedValue({
        id: 'p3',
        groupId: null,
      });
      prisma.hajjRegistrationPilgrim.count.mockResolvedValue(2); // already at maxCapacity=2

      await expect(service.assignPilgrim('group-1', 'p3')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.hajjRegistrationPilgrim.update).not.toHaveBeenCalled();
    });

    it('allows re-assigning a pilgrim already in the group even when at capacity (no-op move)', async () => {
      prisma.hajjRegistrationPilgrim.findUnique.mockResolvedValue({
        id: 'p1',
        groupId: 'group-1',
      });
      prisma.hajjRegistrationPilgrim.count.mockResolvedValue(2);
      prisma.hajjRegistrationPilgrim.update.mockResolvedValue({
        id: 'p1',
        groupId: 'group-1',
      });

      await expect(
        service.assignPilgrim('group-1', 'p1'),
      ).resolves.toBeDefined();
    });

    it('404s when the pilgrim does not exist', async () => {
      prisma.hajjRegistrationPilgrim.findUnique.mockResolvedValue(null);

      await expect(service.assignPilgrim('group-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removePilgrim', () => {
    it('refuses to remove a pilgrim who is not actually in this group', async () => {
      prisma.hajjRegistrationPilgrim.findUnique.mockResolvedValue({
        id: 'p1',
        groupId: 'some-other-group',
      });

      await expect(service.removePilgrim('group-1', 'p1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
