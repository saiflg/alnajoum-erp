import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyService } from '../company/company.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    passwordResetToken: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbacService: { getEffectiveAccess: jest.Mock };
  let auditService: { record: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let twoFactorService: { verifyChallenge: jest.Mock };
  let notificationsService: { sendPasswordResetEmail: jest.Mock };

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
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    notificationsService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
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
        { provide: NotificationsService, useValue: notificationsService },
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
      prisma.identity.update.mockResolvedValue({
        ...baseIdentity,
        failedLoginCount: 1,
      });

      await expect(
        service.validateCredentials('user@example.com', 'wrong-password1'),
      ).rejects.toThrow(UnauthorizedException);

      // The counter moves in the database (atomic increment), not from a value read earlier.
      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { failedLoginCount: { increment: 1 } },
      });
    });

    it('looks the account up by its normalised (trimmed, lower-case) email', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);
      await expect(
        service.validateCredentials('  User@Example.COM ', 'x'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.identity.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('does not reveal a locked account through a different message than the lock hint', async () => {
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      await expect(
        service.validateCredentials('user@example.com', 'whatever'),
      ).rejects.toThrow(/temporarily unavailable/);
    });

    it('locks the account after reaching the max failed attempts', async () => {
      const passwordHash = await argon2.hash('correct-password1');
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        passwordHash,
        failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });
      // The atomic increment reports the new total, which has reached the limit.
      prisma.identity.update.mockResolvedValueOnce({
        ...baseIdentity,
        failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS,
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
      prisma.identity.findUnique.mockResolvedValue(baseIdentity);
      prisma.identity.update.mockResolvedValue({
        ...baseIdentity,
        failedLoginCount: 1,
      });
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

    it('counts wrong second-factor codes toward the same lockout as wrong passwords', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUnique.mockResolvedValue(baseIdentity);
      prisma.identity.update.mockResolvedValueOnce({
        ...baseIdentity,
        failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS,
      });
      twoFactorService.verifyChallenge.mockResolvedValue(false);

      await expect(
        service.verifyTwoFactorLogin('token', '000000', {}),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.identity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'security.account_locked' }),
      );
    });

    it('refuses to even check a code while the account is locked', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.verifyTwoFactorLogin('token', '123456', {}),
      ).rejects.toThrow(UnauthorizedException);
      expect(twoFactorService.verifyChallenge).not.toHaveBeenCalled();
    });

    it('refuses a deactivated account even with a valid code', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        status: 'DEACTIVATED',
      });
      twoFactorService.verifyChallenge.mockResolvedValue(true);

      await expect(
        service.verifyTwoFactorLogin('token', '123456', {}),
      ).rejects.toThrow('This account is not active');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('a challenge is single-use: it is spent once the account has signed in since it was issued', async () => {
      const issuedAt = Math.floor(Date.now() / 1000) - 60;
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
        issuedAtMs: issuedAt * 1000,
      });
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        lastLoginAt: new Date((issuedAt + 30) * 1000),
      });
      twoFactorService.verifyChallenge.mockResolvedValue(true);

      await expect(
        service.verifyTwoFactorLogin('token', '123456', {}),
      ).rejects.toThrow(/expired/);
      expect(twoFactorService.verifyChallenge).not.toHaveBeenCalled();
    });

    it('a challenge issued just after the previous sign-in (same second) is still good', async () => {
      const now = Date.now();
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
        issuedAtMs: now,
        iat: Math.floor(now / 1000),
      });
      prisma.identity.findUnique.mockResolvedValue({
        ...baseIdentity,
        lastLoginAt: new Date(now - 200),
      });
      twoFactorService.verifyChallenge.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyTwoFactorLogin('token', '123456', {});
      expect(result.accessToken).toBeDefined();
    });

    it('issues a full session for a valid code', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'identity-1',
        purpose: '2fa_challenge',
      });
      prisma.identity.findUnique.mockResolvedValue(baseIdentity);
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

  describe('refresh token reuse detection', () => {
    const rotated = (revokedAgoMs: number) => ({
      id: 'rt-old',
      identityId: 'identity-1',
      revokedAt: new Date(Date.now() - revokedAgoMs),
      replacedById: 'rt-new',
      expiresAt: new Date(Date.now() + 3600_000),
      identity: baseIdentity,
    });

    it('a rotated token replayed long after rotation revokes every session of that login', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(rotated(5 * 60_000));
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.refresh('stolen', {})).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { identityId: 'identity-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.refresh_token_reuse',
          metadata: { sessionsRevoked: 3 },
        }),
      );
    });

    it('a parallel refresh inside the grace window is just refused, not treated as theft', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(rotated(2_000));

      await expect(service.refresh('double-click', {})).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('a token revoked by logout (never rotated) is refused without a mass revocation', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...rotated(5 * 60_000),
        replacedById: null,
      });

      await expect(service.refresh('logged-out', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rotation records which token replaced the old one', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        identityId: 'identity-1',
        revokedAt: null,
        replacedById: null,
        expiresAt: new Date(Date.now() + 3600_000),
        identity: baseIdentity,
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      await service.refresh('good', {});

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { replacedById: 'rt-2' },
      });
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

    it.each(['SUSPENDED', 'DEACTIVATED'])(
      'refuses to mint tokens for a %s account, without consuming the token',
      async (status) => {
        prisma.refreshToken.findUnique.mockResolvedValue({
          id: 'rt-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 100000),
          identity: { ...baseIdentity, status },
        });

        await expect(service.refresh('tok', {})).rejects.toThrow(
          'This account is not active',
        );
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      },
    );

    it('loses cleanly when a concurrent refresh already consumed the token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        identity: baseIdentity,
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh('tok', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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

  describe('forgotPassword', () => {
    it('does nothing (no email, no token) when the email does not exist — anti-enumeration', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);

      await service.forgotPassword('missing@example.com', {});

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(
        notificationsService.sendPasswordResetEmail,
      ).not.toHaveBeenCalled();
    });

    it('creates a hashed token and emails a reset link for an existing identity', async () => {
      prisma.identity.findUnique.mockResolvedValue(baseIdentity);
      prisma.staff.findUnique.mockResolvedValue({ companyId: 'company-1' });

      await service.forgotPassword('user@example.com', {});

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identityId: 'identity-1',
            tokenHash: expect.any(String),
          }),
        }),
      );
      // The plaintext token was never persisted — only its hash.
      const createCall = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(createCall.data.tokenHash).not.toContain('reset-password?token=');
      expect(notificationsService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        'identity-1',
        expect.stringContaining('/reset-password?token='),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.password_reset_requested',
        }),
      );
    });
  });

  describe('resetPassword', () => {
    it('rejects an unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword(
          { token: 'bogus', newPassword: 'new-password2' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        identityId: 'identity-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        identity: baseIdentity,
      });

      await expect(
        service.resetPassword(
          { token: 'used', newPassword: 'new-password2' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        identityId: 'identity-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        identity: baseIdentity,
      });

      await expect(
        service.resetPassword(
          { token: 'expired', newPassword: 'new-password2' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates the password, marks the token used, and revokes every refresh token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        identityId: 'identity-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        identity: baseIdentity,
      });

      await service.resetPassword(
        { token: 'valid-token', newPassword: 'new-password2' },
        {},
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.identity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'identity-1' },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prt-1' },
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { identityId: 'identity-1', revokedAt: null },
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.password_reset_completed',
        }),
      );
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
