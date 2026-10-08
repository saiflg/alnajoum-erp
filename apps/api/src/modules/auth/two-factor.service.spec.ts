import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { FieldCipher } from '../../common/security/field-cipher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from './two-factor.service';

interface Row {
  id: string;
  email?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string | null;
  twoFactorLastStep?: number | null;
}

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let row: Row | null;
  let prisma: {
    identity: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    twoFactorRecoveryCode: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  const seal = (secret: string, id = 'identity-1') =>
    FieldCipher.default().encrypt(secret, `identity:${id}:twoFactorSecret`);

  beforeEach(async () => {
    row = null;
    prisma = {
      identity: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(
          ({ data }: { data: Partial<Row> }): Promise<Row | null> => {
            if (row) Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        // Behaves like the database: only claims a step that moves forward.
        updateMany: jest.fn(
          ({ data }: { data: { twoFactorLastStep: number } }) => {
            const last = row?.twoFactorLastStep;
            if (
              last === null ||
              last === undefined ||
              last < data.twoFactorLastStep
            ) {
              row!.twoFactorLastStep = data.twoFactorLastStep;
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          },
        ),
      },
      twoFactorRecoveryCode: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(TwoFactorService);
  });

  describe('generateSetup', () => {
    it('throws NotFound for a missing identity', async () => {
      await expect(service.generateSetup('missing')).rejects.toThrow(
        'Identity not found',
      );
    });

    it('throws Conflict when 2FA is already enabled', async () => {
      row = {
        id: 'identity-1',
        email: 'a@example.com',
        twoFactorEnabled: true,
      };
      await expect(service.generateSetup('identity-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('stores the secret ENCRYPTED, returns a scannable QR code, and does not enable 2FA yet', async () => {
      row = {
        id: 'identity-1',
        email: 'a@example.com',
        twoFactorEnabled: false,
      };

      const result = await service.generateSetup('identity-1');

      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      const stored = prisma.identity.update.mock.calls[0][0].data
        .twoFactorSecret as string;
      expect(stored).not.toContain(result.secret);
      expect(FieldCipher.isEncrypted(stored)).toBe(true);
      expect(
        FieldCipher.default().decrypt(
          stored,
          'identity:identity-1:twoFactorSecret',
        ),
      ).toBe(result.secret);
      expect(row.twoFactorEnabled).toBe(false);
    });

    it('binds the ciphertext to the identity: a copy on another row does not decrypt', async () => {
      row = {
        id: 'identity-1',
        email: 'a@example.com',
        twoFactorEnabled: false,
      };
      const result = await service.generateSetup('identity-1');
      const stored = prisma.identity.update.mock.calls[0][0].data
        .twoFactorSecret as string;
      expect(result.secret).toBeTruthy();
      expect(() =>
        FieldCipher.default().decrypt(
          stored,
          'identity:someone-else:twoFactorSecret',
        ),
      ).toThrow();
    });
  });

  describe('startup migration of legacy plaintext secrets', () => {
    it('encrypts every plaintext secret and leaves nothing readable', async () => {
      prisma.identity.findMany.mockResolvedValue([
        { id: 'identity-1', twoFactorSecret: 'PLAINTEXTSECRET1' },
      ]);
      await service.onModuleInit();
      const written = prisma.identity.update.mock.calls[0][0].data
        .twoFactorSecret as string;
      expect(FieldCipher.isEncrypted(written)).toBe(true);
      expect(written).not.toContain('PLAINTEXTSECRET1');
      expect(
        FieldCipher.default().decrypt(
          written,
          'identity:identity-1:twoFactorSecret',
        ),
      ).toBe('PLAINTEXTSECRET1');
    });

    it('does not stop the application from starting if it fails', async () => {
      prisma.identity.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('verifyAndEnable', () => {
    it('throws BadRequest when no setup is pending', async () => {
      row = { id: 'identity-1', twoFactorSecret: null };
      await expect(
        service.verifyAndEnable('identity-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws Unauthorized for an invalid code', async () => {
      row = {
        id: 'identity-1',
        twoFactorSecret: seal(authenticator.generateSecret()),
      };
      await expect(
        service.verifyAndEnable('identity-1', '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('enables 2FA, returns 8 unique high-entropy recovery codes, and spends the enrolment code', async () => {
      const secret = authenticator.generateSecret();
      row = { id: 'identity-1', twoFactorSecret: seal(secret) };

      const result = await service.verifyAndEnable(
        'identity-1',
        authenticator.generate(secret),
      );

      expect(result.enabled).toBe(true);
      expect(result.recoveryCodes).toHaveLength(8);
      expect(new Set(result.recoveryCodes).size).toBe(8);
      // 80 bits: four groups of five hex characters.
      expect(result.recoveryCodes[0]).toMatch(/^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/);
      expect(row.twoFactorEnabled).toBe(true);
      expect(row.twoFactorLastStep).toEqual(expect.any(Number));
      expect(prisma.twoFactorRecoveryCode.createMany).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'security.2fa_enabled' }),
      );
    });

    it('reads a legacy plaintext secret too (not yet migrated)', async () => {
      const secret = authenticator.generateSecret();
      row = { id: 'identity-1', twoFactorSecret: secret };
      await expect(
        service.verifyAndEnable('identity-1', authenticator.generate(secret)),
      ).resolves.toMatchObject({ enabled: true });
    });
  });

  describe('verifyChallenge', () => {
    it('returns false when 2FA is not enabled', async () => {
      row = { id: 'identity-1', twoFactorEnabled: false };
      await expect(
        service.verifyChallenge('identity-1', '123456'),
      ).resolves.toBe(false);
    });

    it('accepts a valid TOTP code from an encrypted secret', async () => {
      const secret = authenticator.generateSecret();
      row = {
        id: 'identity-1',
        twoFactorEnabled: true,
        twoFactorSecret: seal(secret),
      };
      await expect(
        service.verifyChallenge('identity-1', authenticator.generate(secret)),
      ).resolves.toBe(true);
    });

    it('refuses to accept the SAME code twice (replay protection)', async () => {
      const secret = authenticator.generateSecret();
      row = {
        id: 'identity-1',
        twoFactorEnabled: true,
        twoFactorSecret: seal(secret),
      };
      const code = authenticator.generate(secret);

      await expect(service.verifyChallenge('identity-1', code)).resolves.toBe(
        true,
      );
      await expect(service.verifyChallenge('identity-1', code)).resolves.toBe(
        false,
      );
    });

    it('falls back to an unused recovery code and consumes it atomically', async () => {
      const secret = authenticator.generateSecret();
      row = { id: 'identity-1', twoFactorSecret: seal(secret) };
      const { recoveryCodes } = await service.verifyAndEnable(
        'identity-1',
        authenticator.generate(secret),
      );
      const storedHashes = prisma.twoFactorRecoveryCode.createMany.mock
        .calls[0][0].data as Array<{ codeHash: string }>;
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue(
        storedHashes.map((r, i) => ({ id: `code-${i}`, ...r })),
      );

      const result = await service.verifyChallenge(
        'identity-1',
        recoveryCodes[0],
      );

      expect(result).toBe(true);
      expect(prisma.twoFactorRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'code-0', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('does not accept a recovery code that a concurrent request already used', async () => {
      const secret = authenticator.generateSecret();
      row = { id: 'identity-1', twoFactorSecret: seal(secret) };
      const { recoveryCodes } = await service.verifyAndEnable(
        'identity-1',
        authenticator.generate(secret),
      );
      const storedHashes = prisma.twoFactorRecoveryCode.createMany.mock
        .calls[0][0].data as Array<{ codeHash: string }>;
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue(
        storedHashes.map((r, i) => ({ id: `code-${i}`, ...r })),
      );
      prisma.twoFactorRecoveryCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyChallenge('identity-1', recoveryCodes[0]),
      ).resolves.toBe(false);
    });

    it('rejects a wrong code', async () => {
      row = {
        id: 'identity-1',
        twoFactorEnabled: true,
        twoFactorSecret: seal(authenticator.generateSecret()),
      };
      await expect(
        service.verifyChallenge('identity-1', '000000'),
      ).resolves.toBe(false);
    });
  });

  describe('disable', () => {
    it('throws Conflict when 2FA is not enabled', async () => {
      row = { id: 'identity-1', twoFactorEnabled: false };
      await expect(service.disable('identity-1', '123456')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws Unauthorized for an invalid code and never disables', async () => {
      row = {
        id: 'identity-1',
        twoFactorEnabled: true,
        twoFactorSecret: seal(authenticator.generateSecret()),
      };
      await expect(service.disable('identity-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.identity.update).not.toHaveBeenCalled();
    });

    it('disables 2FA and clears every recovery code for a valid code', async () => {
      const secret = authenticator.generateSecret();
      row = {
        id: 'identity-1',
        twoFactorEnabled: true,
        twoFactorSecret: seal(secret),
      };

      await service.disable('identity-1', authenticator.generate(secret));

      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorLastStep: null,
        },
      });
      expect(prisma.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { identityId: 'identity-1' },
      });
    });
  });

  describe('adminDisable', () => {
    it('disables without requiring a code, and audits it as an override', async () => {
      row = { id: 'identity-1', twoFactorEnabled: true };

      await service.adminDisable('identity-1', 'admin-identity');

      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorLastStep: null,
        },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.2fa_disabled_by_admin',
          metadata: { overriddenByIdentityId: 'admin-identity' },
        }),
      );
    });
  });
});
