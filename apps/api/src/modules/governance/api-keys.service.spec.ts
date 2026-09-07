import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: {
    apiKey: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  describe('create', () => {
    it('returns the raw key exactly once, alongside the stored (hashed) record', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-1',
        keyPrefix: 'abcd1234',
        keyHash: 'hashed',
      });

      const result = await service.create('identity-1', { name: 'CI key' });

      expect(result.rawKey).toEqual(expect.any(String));
      expect(result.rawKey.length).toBeGreaterThanOrEqual(32);
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'CI key',
            keyPrefix: expect.any(String),
            keyHash: expect.any(String),
          }),
        }),
      );
      // The hash must never equal the raw key.
      const createCall = prisma.apiKey.create.mock.calls[0][0].data;
      expect(createCall.keyHash).not.toBe(result.rawKey);
    });
  });

  describe('revoke', () => {
    it('throws NotFound for a missing key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.revoke('key-1', 'identity-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the caller does not own the key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        ownerIdentityId: 'someone-else',
        status: ApiKeyStatus.ACTIVE,
      });

      await expect(service.revoke('key-1', 'identity-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('revokes an owned, active key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        ownerIdentityId: 'identity-1',
        status: ApiKeyStatus.ACTIVE,
      });
      prisma.apiKey.update.mockResolvedValue({});

      await service.revoke('key-1', 'identity-1');

      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ApiKeyStatus.REVOKED }),
        }),
      );
    });
  });
});
