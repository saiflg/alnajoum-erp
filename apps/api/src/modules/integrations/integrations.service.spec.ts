import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldCipher } from '../../common/security/field-cipher';
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
        update: jest.fn(),
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

  describe('onModuleInit (legacy plaintext migration)', () => {
    it('encrypts plaintext secrets already in the database and leaves everything else alone', async () => {
      prisma.integrationCredential.findMany.mockResolvedValue([
        {
          id: 'r1',
          category: 'PAYMENT',
          provider: 'paystack',
          config: { secretKey: 'sk_plain' },
        },
        { id: 'r2', category: 'FLIGHT', provider: 'mock', config: {} },
      ]);

      await service.onModuleInit();

      expect(prisma.integrationCredential.update).toHaveBeenCalledTimes(1);
      const call = prisma.integrationCredential.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'r1' });
      expect(JSON.stringify(call.data)).not.toContain('sk_plain');
      expect(
        FieldCipher.default().decrypt(
          call.data.config.secretKey,
          'integration:PAYMENT:paystack:secretKey',
        ),
      ).toBe('sk_plain');
    });

    it('never stops the application from starting', async () => {
      prisma.integrationCredential.findMany.mockRejectedValue(
        new Error('db down'),
      );
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('getCredentialConfig', () => {
    it('decrypts secret fields for internal callers and passes legacy plaintext through', async () => {
      const enc = FieldCipher.default().encrypt(
        'sk_live_x',
        'integration:PAYMENT:paystack:secretKey',
      );
      prisma.integrationCredential.findUnique.mockResolvedValue({
        config: { secretKey: enc },
      });
      await expect(
        service.getCredentialConfig('PAYMENT', 'paystack'),
      ).resolves.toEqual({ secretKey: 'sk_live_x' });

      prisma.integrationCredential.findUnique.mockResolvedValue({
        config: { secretKey: 'old_plain' },
      });
      await expect(
        service.getCredentialConfig('PAYMENT', 'paystack'),
      ).resolves.toEqual({ secretKey: 'old_plain' });
    });

    it('returns null when nothing has been saved', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.getCredentialConfig('PAYMENT', 'paystack'),
      ).resolves.toBeNull();
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

      const stored =
        prisma.integrationCredential.upsert.mock.calls[0][0].create.config;
      expect(stored.host).toBe('smtp.example.com');
      expect(stored.user).toBe('existing-user');
      // The secret is stored encrypted, not as typed.
      expect(stored.password).not.toBe('new-password');
      expect(
        FieldCipher.default().decrypt(
          stored.password,
          'integration:NOTIFICATION:smtp:password',
        ),
      ).toBe('new-password');
    });

    it('stores secret fields encrypted and leaves non-secret fields readable', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await service.upsertCredential(
        'PAYMENT',
        'paystack',
        { secretKey: 'sk_live_abc' },
        'identity-1',
      );

      const stored =
        prisma.integrationCredential.upsert.mock.calls[0][0].create.config;
      expect(JSON.stringify(stored)).not.toContain('sk_live_abc');
      expect(FieldCipher.isEncrypted(stored.secretKey)).toBe(true);
    });

    it('rejects settings the provider does not define and non-string or oversized values', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertCredential(
          'PAYMENT',
          'paystack',
          { isAdmin: 'true' },
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsertCredential(
          'PAYMENT',
          'paystack',
          { secretKey: { nested: 1 } as never },
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsertCredential(
          'PAYMENT',
          'paystack',
          { secretKey: 'x'.repeat(5000) },
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.integrationCredential.upsert).not.toHaveBeenCalled();
    });

    it('rejects an AI baseUrl that points at the metadata service and an SMTP host that is not a host', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertCredential(
          'AI',
          'openai-compatible',
          { baseUrl: 'http://169.254.169.254/latest' },
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsertCredential(
          'NOTIFICATION',
          'smtp',
          { host: 'evil.com/x' },
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.integrationCredential.upsert).not.toHaveBeenCalled();
    });

    it('brings previously plaintext secrets up to encryption when the row is saved again', async () => {
      prisma.integrationCredential.findUnique.mockResolvedValue({
        config: { host: 'smtp.example.com', password: 'legacy-plaintext' },
      });

      await service.upsertCredential(
        'NOTIFICATION',
        'smtp',
        { user: 'u' },
        'identity-1',
      );

      const stored =
        prisma.integrationCredential.upsert.mock.calls[0][0].create.config;
      expect(FieldCipher.isEncrypted(stored.password)).toBe(true);
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
      expect(
        JSON.stringify(auditService.record.mock.calls[0][0]),
      ).not.toContain('sk_live_super_secret');
    });

    it('rejects an unknown provider for the category', async () => {
      await expect(
        service.upsertCredential(
          'PAYMENT',
          'not-a-real-provider',
          {},
          'identity-1',
        ),
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
          create: expect.objectContaining({
            provider: 'duffel',
            isActive: true,
          }),
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
      prisma.integrationCredential.findFirst.mockResolvedValue({
        provider: 'duffel',
      });

      await expect(service.getActiveProvider('FLIGHT')).resolves.toBe('duffel');
    });
  });
});
