import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { FamilyMembersService } from './family-members.service';

describe('FamilyMembersService', () => {
  let service: FamilyMembersService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      familyMember: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FamilyMembersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FamilyMembersService);
  });

  describe('getMember', () => {
    it('throws NotFound when the member does not exist', async () => {
      prisma.familyMember.findUnique.mockResolvedValue(null);

      await expect(service.getMember('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the member belongs to a different customer', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({
        id: 'member-1',
        customerId: 'customer-a',
      });

      await expect(service.getMember('member-1', 'customer-b')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the member when it belongs to the given owner', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({
        id: 'member-1',
        customerId: 'customer-a',
      });

      await expect(
        service.getMember('member-1', 'customer-a'),
      ).resolves.toEqual(expect.objectContaining({ id: 'member-1' }));
    });
  });

  describe('create', () => {
    it('converts date-only strings to Date objects before writing', async () => {
      prisma.familyMember.create.mockResolvedValue({ id: 'member-1' });

      await service.create('customer-a', {
        relationship: 'CHILD',
        firstName: 'Zara',
        lastName: 'Bello',
        dateOfBirth: '2015-06-01',
        passportExpiryDate: '2030-01-01',
      });

      expect(prisma.familyMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'customer-a',
          dateOfBirth: new Date('2015-06-01'),
          passportExpiryDate: new Date('2030-01-01'),
        }),
      });
    });
  });

  describe('update', () => {
    it('rejects updating a member owned by someone else', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({
        id: 'member-1',
        customerId: 'customer-a',
      });

      await expect(
        service.update('member-1', { firstName: 'X' }, 'customer-b'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.familyMember.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('rejects deleting a member owned by someone else', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({
        id: 'member-1',
        customerId: 'customer-a',
      });

      await expect(service.remove('member-1', 'customer-b')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.familyMember.delete).not.toHaveBeenCalled();
    });
  });
});
