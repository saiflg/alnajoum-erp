import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyService } from '../company/company.service';
import { RbacService } from '../rbac/rbac.service';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';
import { MAX_FAILED_LOGIN_ATTEMPTS } from './auth.constants';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    identity: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
    staff: Record<string, jest.Mock>;
    customer: Record<string, jest.Mock>;
  };
  let rbacService: { getEffectiveAccess: jest.Mock };
  let auditService: { record: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let twoFactorService: { verifyChallenge: jest.Mock };

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
      staff: { findUnique: jest.fn() },
      customer: { findUnique: jest.fn() },
    };
    rbacService = {
      getEffectiveAccess: jest
        .fn()
        .mockResolvedValue({ roles: ['STAFF'], permissions: ['staff:read'] }),
    };
    auditService = { record: jest.fn() };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
    };
    twoFactorService = { verifyChallenge: jest.fn() };
    const companyService = {
      getDefaultCompanyId: jest.fn().mockResolvedValue('company-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyService, useValue: companyService },
        { provide: JwtService, useValue: jwtService },
        { provide: TwoFactorService, useValue: twoFactorService },
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

  describe('login', () => {
    it('returns a token pair directly when 2FA is not enabled (unchanged pre-Phase-11 behavior)', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
        twoFactorEnabled: false,
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(
        { email: 'user@example.com', password: 'correct-password1' },
        {},
      );

      expect('requiresTwoFactor' in result).toBe(false);
      expect((result as { accessToken: string }).accessToken).toBeDefined();
    });

    it('returns a 2FA challenge instead of a session when 2FA is enabled', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
        twoFactorEnabled: true,
      });

      const result = await service.login(
        { email: 'user@example.com', password: 'correct-password1' },
        {},
      );

      expect(result).toEqual({
        requiresTwoFactor: true,
        challengeToken: 'signed.jwt.token',
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login' }),
      );
    });
  });

  describe('verifyTwoFactorLogin', () => {
    it('rejects an expired/invalid challenge token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(
        service.verifyTwoFactorLogin('bad-token', '123456', {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token whose purpose is not 2fa_challenge', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: 'something_else',
      });

      await expect(
        service.verifyTwoFactorLogin('token', '123456', {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an invalid code and records a security event, without issuing a session', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUniqueOrThrow.mockResolvedValue(baseIdentity);
      twoFactorService.verifyChallenge.mockResolvedValue(false);

      await expect(
        service.verifyTwoFactorLogin('token', '000000', {}),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.login_failed',
          metadata: { reason: '2fa_code_invalid' },
        }),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('issues a full session for a valid code', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUniqueOrThrow.mockResolvedValue(baseIdentity);
      twoFactorService.verifyChallenge.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyTwoFactorLogin('token', '123456', {});

      expect(result.accessToken).toBeDefined();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login',
          metadata: { via2fa: true },
        }),
      );
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

  describe('getMe', () => {
    it("surfaces the staff member's real company/branch name for the top nav", async () => {
      prisma.identity.findUniqueOrThrow.mockResolvedValue({
        ...baseIdentity,
        customer: null,
        staff: {
          id: 'staff-1',
          firstName: 'Fatima',
          lastName: 'Sule',
          company: { id: 'company-1', name: 'Alnajoum Travel Agency' },
          branch: { id: 'branch-1', name: 'Kaduna HQ' },
        },
      });

      const result = await service.getMe('identity-1');

      expect(result.companyName).toBe('Alnajoum Travel Agency');
      expect(result.branchName).toBe('Kaduna HQ');
    });

    it('is null for a customer identity, which has no company scope', async () => {
      prisma.identity.findUniqueOrThrow.mockResolvedValue({
        ...baseIdentity,
        type: 'CUSTOMER',
        customer: { id: 'customer-1', firstName: 'Amina', lastName: 'Yusuf' },
        staff: null,
      });

      const result = await service.getMe('identity-1');

      expect(result.companyName).toBeNull();
      expect(result.branchName).toBeNull();
    });
  });
});
