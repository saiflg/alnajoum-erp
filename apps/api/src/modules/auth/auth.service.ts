import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Identity, IdentityType } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import {
  durationToMs,
  durationToSeconds,
} from '../../common/utils/duration.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyService } from '../company/company.service';
import { TwoFactorService } from './two-factor.service';
import {
  DEFAULT_ROLE_DEFINITIONS,
  ROLE_DASHBOARD_PRECEDENCE,
  SYSTEM_ROLES,
} from '../rbac/constants/default-roles.constant';
import { RbacService } from '../rbac/rbac.service';
import {
  ACCOUNT_LOCK_DURATION_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth.constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  identity: {
    id: string;
    email: string;
    type: IdentityType;
    roles: string[];
    dashboardPath: string;
  };
}

/** Phase 11 — what login() returns instead of a TokenPair when the
 * identity has 2FA enabled. Carries no session of any kind — only
 * verifyTwoFactorLogin(challengeToken, code) can turn this into one. */
export interface TwoFactorChallenge {
  requiresTwoFactor: true;
  challengeToken: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly companyService: CompanyService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  private resolveDashboardPath(roles: string[]): string {
    const match = ROLE_DASHBOARD_PRECEDENCE.find((entry) =>
      roles.includes(entry.role),
    );
    return match?.dashboardPath ?? '/portal/dashboard';
  }

  async registerCustomer(
    dto: RegisterCustomerDto,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const existing = await this.prisma.identity.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const customerRole = await this.prisma.role.findUnique({
      where: { name: SYSTEM_ROLES.CUSTOMER },
    });
    // Phase 11 — a public sign-up has no tenant context of its own to
    // supply, and never should: the platform's one active company is the
    // only sane default (see CompanyService.getDefaultCompanyId's own
    // doc comment), never something the request body gets to pick.
    const companyId = await this.companyService.getDefaultCompanyId();

    const identity = await this.prisma.identity.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        type: IdentityType.CUSTOMER,
        customer: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            companyId,
          },
        },
        ...(customerRole && {
          roles: { create: [{ roleId: customerRole.id }] },
        }),
      },
    });

    await this.auditService.record({
      identityId: identity.id,
      action: 'auth.register',
      entityType: 'Identity',
      entityId: identity.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.issueTokenPair(identity, meta);
  }

  async validateCredentials(
    email: string,
    password: string,
    meta: RequestMeta = {},
  ): Promise<Identity> {
    const identity = await this.prisma.identity.findUnique({
      where: { email },
    });

    if (!identity) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (identity.lockedUntil && identity.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked due to repeated failed login attempts',
      );
    }

    const passwordMatches = await argon2.verify(
      identity.passwordHash,
      password,
    );

    if (!passwordMatches) {
      const failedLoginCount = identity.failedLoginCount + 1;
      const shouldLock = failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS;

      await this.prisma.identity.update({
        where: { id: identity.id },
        data: {
          failedLoginCount: shouldLock ? 0 : failedLoginCount,
          lockedUntil: shouldLock
            ? new Date(Date.now() + ACCOUNT_LOCK_DURATION_MINUTES * 60 * 1000)
            : null,
        },
      });

      // Phase 11 spec #17/#18 — every failed attempt and every lockout is
      // a security event, not just a silent counter increment.
      await this.auditService.record({
        identityId: identity.id,
        action: 'security.login_failed',
        entityType: 'Identity',
        entityId: identity.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (shouldLock) {
        await this.auditService.record({
          identityId: identity.id,
          action: 'security.account_locked',
          entityType: 'Identity',
          entityId: identity.id,
          metadata: { durationMinutes: ACCOUNT_LOCK_DURATION_MINUTES },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      }

      throw new UnauthorizedException('Invalid email or password');
    }

    if (identity.status === 'SUSPENDED' || identity.status === 'DEACTIVATED') {
      throw new UnauthorizedException('This account is not active');
    }

    if (identity.failedLoginCount > 0 || identity.lockedUntil) {
      if (identity.lockedUntil) {
        await this.auditService.record({
          identityId: identity.id,
          action: 'security.account_unlocked',
          entityType: 'Identity',
          entityId: identity.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      }
      await this.prisma.identity.update({
        where: { id: identity.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    return identity;
  }

  /** Signed with JWT_REFRESH_SECRET (a second secret this codebase already
   * provisions but never otherwise signs with) so a challenge token can
   * never be mistaken for — or accepted as — a real access token; the
   * passport-jwt strategy verifies against JWT_ACCESS_SECRET specifically,
   * so a mismatched signature is rejected before JwtAccessStrategy.validate
   * ever runs. 5 minutes is long enough to type a 6-digit code, not long
   * enough to be a meaningful standing credential if intercepted. */
  private async issueTwoFactorChallenge(identityId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: identityId, purpose: '2fa_challenge' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: 300,
      },
    );
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta,
  ): Promise<TokenPair | TwoFactorChallenge> {
    const identity = await this.validateCredentials(
      dto.email,
      dto.password,
      meta,
    );

    if (identity.twoFactorEnabled) {
      // Password was correct, but the session isn't authenticated yet —
      // no lastLoginAt bump, no token pair, no "auth.login" audit entry
      // until the second factor actually clears (see verifyTwoFactorLogin).
      return {
        requiresTwoFactor: true,
        challengeToken: await this.issueTwoFactorChallenge(identity.id),
      };
    }

    await this.prisma.identity.update({
      where: { id: identity.id },
      data: { lastLoginAt: new Date() },
    });

    await this.auditService.record({
      identityId: identity.id,
      action: 'auth.login',
      entityType: 'Identity',
      entityId: identity.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.issueTokenPair(identity, meta);
  }

  /** Completes a login that stopped at requiresTwoFactor. Verifies the
   * challenge token's own signature/expiry (via JwtService, same secret
   * issueTwoFactorChallenge signed with) before ever looking at the code. */
  async verifyTwoFactorLogin(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwtService.verifyAsync(challengeToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(
        'This 2FA challenge has expired — log in again',
      );
    }
    if (payload.purpose !== '2fa_challenge') {
      throw new UnauthorizedException('Invalid 2FA challenge token');
    }

    const identity = await this.prisma.identity.findUniqueOrThrow({
      where: { id: payload.sub },
    });
    const valid = await this.twoFactorService.verifyChallenge(
      identity.id,
      code,
    );
    if (!valid) {
      await this.auditService.record({
        identityId: identity.id,
        action: 'security.login_failed',
        entityType: 'Identity',
        entityId: identity.id,
        metadata: { reason: '2fa_code_invalid' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid authenticator or recovery code');
    }

    await this.prisma.identity.update({
      where: { id: identity.id },
      data: { lastLoginAt: new Date() },
    });
    await this.auditService.record({
      identityId: identity.id,
      action: 'auth.login',
      entityType: 'Identity',
      entityId: identity.id,
      metadata: { via2fa: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.issueTokenPair(identity, meta);
  }

  private async issueTokenPair(
    identity: Identity,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const { roles } = await this.rbacService.getEffectiveAccess(identity.id);

    const refreshTokenExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const refreshToken = randomBytes(48).toString('hex');

    // Created before the access token is signed, purely so its id exists
    // to embed as `sessionId` below (see AuthContext.sessionId's doc
    // comment) — the row is otherwise unchanged from before Phase 11.
    const refreshTokenRecord = await this.prisma.refreshToken.create({
      data: {
        identityId: identity.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + durationToMs(refreshTokenExpiresIn)),
        createdByIp: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    // `permissions` deliberately never goes into the signed payload — see
    // JwtAccessStrategy.validate's doc comment: a large permission set
    // (SUPER_ADMIN/COMPANY_ADMIN) would blow the access_token cookie past
    // the ~4KB limit browsers silently enforce per cookie. The strategy
    // resolves permissions fresh from the DB on every request instead.
    const payload: Pick<AuthContext, 'sub' | 'type' | 'roles'> & {
      sessionId: string;
    } = {
      sub: identity.id,
      type: identity.type,
      roles,
      sessionId: refreshTokenRecord.id,
    };

    const accessTokenExpiresIn = this.configService.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    );

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: durationToSeconds(accessTokenExpiresIn),
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn,
      identity: {
        id: identity.id,
        email: identity.email,
        type: identity.type,
        roles,
        dashboardPath: this.resolveDashboardPath(roles),
      },
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { identity: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(stored.identity, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    identityId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const identity = await this.prisma.identity.findUniqueOrThrow({
      where: { id: identityId },
    });

    const matches = await argon2.verify(
      identity.passwordHash,
      dto.currentPassword,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.identity.update({
      where: { id: identityId },
      data: { passwordHash },
    });

    await this.prisma.refreshToken.updateMany({
      where: { identityId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(identityId: string) {
    const identity = await this.prisma.identity.findUniqueOrThrow({
      where: { id: identityId },
      include: {
        customer: true,
        staff: { include: { company: true, branch: true } },
      },
    });
    const { roles, permissions } =
      await this.rbacService.getEffectiveAccess(identityId);

    return {
      id: identity.id,
      email: identity.email,
      phone: identity.phone,
      type: identity.type,
      status: identity.status,
      emailVerifiedAt: identity.emailVerifiedAt,
      roles,
      permissions,
      dashboardPath: this.resolveDashboardPath(roles),
      profile: identity.customer ?? identity.staff,
      // Real tenant context for the top nav — null for customers, who
      // aren't scoped to a company in this schema (there's only ever been
      // one agency operating the platform so far).
      companyName: identity.staff?.company.name ?? null,
      branchName: identity.staff?.branch?.name ?? null,
    };
  }

  /** Seeds Phase 1 default roles/permissions if they don't already exist. */
  async ensureDefaultRolesSeeded(): Promise<void> {
    for (const definition of DEFAULT_ROLE_DEFINITIONS) {
      const role = await this.prisma.role.upsert({
        where: { name: definition.name },
        create: {
          name: definition.name,
          description: definition.description,
          isSystem: definition.isSystem,
        },
        update: {},
      });

      if (definition.permissions.length === 0) continue;

      const permissions = await this.prisma.permission.findMany({
        where: { key: { in: definition.permissions } },
      });

      for (const permission of permissions) {
        await this.prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
    }
    this.logger.log('Default RBAC roles verified/seeded');
  }
}
