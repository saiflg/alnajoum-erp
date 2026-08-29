import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let prisma: {
    integrationCredential: Record<string, jest.Mock>;
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      integrationCredential: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(
      (ops: unknown[]) => Promise.all(ops),
    );
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(IntegrationsService);
  });

  describe('listForCategory', () => {
    it('never returns actual secret values, only whether a field is set', async () => {
      prisma.integrationCredential.findMany.mockResolvedValue([
        {
          provider: 'duffel',
          isActive: true,
          config: { apiKey: 'duffel_live_super_secret' },
          updatedAt: new Date('2026-08-29'),
        },
      ]);

      const result = await service.listForCategory('FLIGHT');

      const duffelRow = result.find((r) => r.provider === 'duffel');
      expect(duffelRow?.isActive).toBe(true);
      expect(duffelRow?.configuredFields).toEqual(['apiKey']);
      expect(JSON.stringify(result)).not.toContain('duffel_live_super_secret');

      const mockRow = result.find((r) => r.provider === 'mock');
      expect(mockRow?.isActive).toBe(false);
      expect(mockRow?.configuredFields).toEqual([]);
    });
  });

  describe('getCredentialConfig', () => {
    it('returns null when nothing has been saved', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await expect(service.getCredentialConfig('PAYMENT', 'paystack')).resolves.toBeNull();
    });
  });

  describe('upsertCredential', () => {
    it('merges into existing config rather than overwriting other fields', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue({
        config: { host: 'smtp.example.com', user: 'existing-user' },
      });

      await service.upsertCredential(
        'NOTIFICATION',
        'smtp',
        { password: 'new-password' },
        'identity-1',
      );

      expect(prisma.integrationCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            config: { host: 'smtp.example.com', user: 'existing-user', password: 'new-password' },
          }),
        }),
      );
    });

    it('audits only field names, never values', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await service.upsertCredential(
        'PAYMENT',
        'paystack',
        { secretKey: 'sk_live_super_secret' },
        'identity-1',
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ fields: ['secretKey'] }),
        }),
      );
      expect(JSON.stringify(auditService.record.mock.calls[0][0])).not.toContain(
        'sk_live_super_secret',
      );
    });

    it('rejects an unknown provider for the category', async () => {
      await expect(
        service.upsertCredential('PAYMENT', 'not-a-real-provider', {}, 'identity-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setActive', () => {
    it('deactivates every other provider in the category first', async () => {
      await service.setActive('FLIGHT', 'duffel', 'identity-1');

      expect(prisma.integrationCredential.updateMany).toHaveBeenCalledWith({
        where: { category: 'FLIGHT' },
        data: { isActive: false },
      });
      expect(prisma.integrationCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ provider: 'duffel', isActive: true }),
          update: { isActive: true },
        }),
      );
    });
  });

  describe('getActiveProvider', () => {
    it('returns null when nothing has been activated yet', async () => {
      prisma.integrationCredential.findFirst.mockResolvedValue(null);

      await expect(service.getActiveProvider('FLIGHT')).resolves.toBeNull();
    });

    it('returns the active provider name', async () => {
      prisma.integrationCredential.findFirst.mockResolvedValue({ provider: 'duffel' });

      await expect(service.getActiveProvider('FLIGHT')).resolves.toBe('duffel');
    });
  });
});
