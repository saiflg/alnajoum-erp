import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthService } from './auth.service';
import { MAX_FAILED_LOGIN_ATTEMPTS } from './auth.constants';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    identity: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
  };
  let rbacService: { getEffectiveAccess: jest.Mock };
  let auditService: { record: jest.Mock };

  const baseIdentity = {
    id: 'identity-1',
    email: 'user@example.com',
    type: 'STAFF',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
  };

  beforeEach(async () => {
    prisma = {
      identity: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    rbacService = {
      getEffectiveAccess: jest
        .fn()
        .mockResolvedValue({ roles: ['STAFF'], permissions: ['staff:read'] }),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => fallback),
            getOrThrow: jest.fn(() => 'secret'),
          },
        },
        { provide: RbacService, useValue: rbacService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('validateCredentials', () => {
    it('throws Unauthorized when identity does not exist', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);

      await expect(
        service.validateCredentials('missing@example.com', 'whatever'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws Unauthorized and increments failedLoginCount on wrong password', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
      });

      await expect(
        service.validateCredentials('user@example.com', 'wrong-password1'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.identity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'identity-1' },
          data: expect.objectContaining({ failedLoginCount: 1 }),
        }),
      );
    });

    it('locks the account after reaching the max failed attempts', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
        failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });

      await expect(
        service.validateCredentials('user@example.com', 'wrong-password1'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.identity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects login while the account is locked', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.validateCredentials('user@example.com', 'correct-password1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('resolves with the identity on correct credentials', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
      });

      const result = await service.validateCredentials(
        'user@example.com',
        'correct-password1',
      );

      expect(result.id).toBe('identity-1');
    });
  });

  describe('registerCustomer', () => {
    it('throws Conflict when the email is already registered', async () => {
      prisma.identity.findUnique.mockResolvedValue(baseIdentity);

      await expect(
        service.registerCustomer(
          {
            email: 'user@example.com',
            password: 'password1',
            firstName: 'A',
            lastName: 'B',
          },
          {},
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('refresh', () => {
    it('throws Unauthorized for an unknown refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('does-not-exist', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized for an expired refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        identity: baseIdentity,
      });

      await expect(service.refresh('expired-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized for a revoked refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        identity: baseIdentity,
      });

      await expect(service.refresh('revoked-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('changePassword', () => {
    it('throws Unauthorized when currentPassword is wrong', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUniqueOrThrow.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
      });

      await expect(
        service.changePassword('identity-1', {
          currentPassword: 'wrong-password1',
          newPassword: 'new-password2',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
