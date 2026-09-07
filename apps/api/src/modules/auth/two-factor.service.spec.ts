import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from './two-factor.service';

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let prisma: {
    identity: { findUnique: jest.Mock; update: jest.Mock };
    twoFactorRecoveryCode: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      identity: { findUnique: jest.fn(), update: jest.fn() },
      twoFactorRecoveryCode: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
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
      prisma.identity.findUnique.mockResolvedValue(null);

      await expect(service.generateSetup('missing')).rejects.toThrow(
        'Identity not found',
      );
    });

    it('throws Conflict when 2FA is already enabled', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-1',
        email: 'a@example.com',
        twoFactorEnabled: true,
      });

      await expect(service.generateSetup('identity-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('stores a secret and returns a scannable QR code, without enabling 2FA yet', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-1',
        email: 'a@example.com',
        twoFactorEnabled: false,
      });

      const result = await service.generateSetup('identity-1');

      expect(result.secret).toEqual(expect.any(String));
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { twoFactorSecret: result.secret },
      });
    });
  });

  describe('verifyAndEnable', () => {
    it('throws BadRequest when no setup is pending', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-1',
        twoFactorSecret: null,
      });

      await expect(
        service.verifyAndEnable('identity-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws Unauthorized for an invalid code', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-1',
        twoFactorSecret: authenticator.generateSecret(),
      });

      await expect(
        service.verifyAndEnable('identity-1', '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('enables 2FA and returns 8 one-time recovery codes for a valid code', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-1',
        twoFactorSecret: secret,
      });

      const result = await service.verifyAndEnable(
        'identity-1',
        authenticator.generate(secret),
      );

      expect(result.enabled).toBe(true);
      expect(result.recoveryCodes).toHaveLength(8);
      expect(new Set(result.recoveryCodes).size).toBe(8); // all unique
      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { twoFactorEnabled: true },
      });
      expect(prisma.twoFactorRecoveryCode.createMany).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'security.2fa_enabled' }),
      );
    });
  });

  describe('verifyChallenge', () => {
    it('returns false when 2FA is not enabled', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
      });

      await expect(
        service.verifyChallenge('identity-1', '123456'),
      ).resolves.toBe(false);
    });

    it('accepts a valid TOTP code', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      await expect(
        service.verifyChallenge('identity-1', authenticator.generate(secret)),
      ).resolves.toBe(true);
    });

    it('falls back to an unused recovery code and consumes it on success', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });
      // A real hash would come from argon2.hash — using verifyAndEnable's
      // own generation path keeps this test honest about the real format.
      prisma.identity.findUnique.mockResolvedValueOnce({
        id: 'identity-1',
        twoFactorSecret: secret,
      });
      const { recoveryCodes } = await service.verifyAndEnable(
        'identity-1',
        authenticator.generate(secret),
      );
      const storedHashes = prisma.twoFactorRecoveryCode.createMany.mock
        .calls[0][0].data as Array<{ codeHash: string }>;
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue(
        storedHashes.map((row, i) => ({ id: `code-${i}`, ...row })),
      );
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      const result = await service.verifyChallenge(
        'identity-1',
        recoveryCodes[0],
      );

      expect(result).toBe(true);
      expect(prisma.twoFactorRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'code-0' },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('rejects a wrong code and a wrong recovery code alike', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      await expect(
        service.verifyChallenge('identity-1', '000000'),
      ).resolves.toBe(false);
    });
  });

  describe('disable', () => {
    it('throws Conflict when 2FA is not enabled', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
      });

      await expect(service.disable('identity-1', '123456')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws Unauthorized for an invalid code and never disables', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      await expect(service.disable('identity-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.identity.update).not.toHaveBeenCalled();
    });

    it('disables 2FA and clears every recovery code for a valid code', async () => {
      const secret = authenticator.generateSecret();
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      await service.disable('identity-1', authenticator.generate(secret));

      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });
      expect(prisma.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { identityId: 'identity-1' },
      });
    });
  });

  describe('adminDisable', () => {
    it('disables without requiring a code, and audits it as an override', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
      });

      await service.adminDisable('identity-1', 'admin-identity');

      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
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
