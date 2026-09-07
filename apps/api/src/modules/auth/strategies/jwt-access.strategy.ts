import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { IdentityType } from '@prisma/client';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';

function extractFromCookie(req: Request): string | null {
  const token = req?.cookies?.access_token as string | undefined;
  return token ?? null;
}

/** What's actually signed into the access token — see AuthService.issueTokenPair.
 * `permissions`/`companyId` are deliberately NOT here (see validate() below
 * for why); `sessionId` IS, since it names which RefreshToken row this
 * access token was minted alongside (older tokens predating Phase 11 won't
 * have it, hence optional). */
type AccessTokenPayload = Pick<AuthContext, 'sub' | 'type' | 'roles'> & {
  sessionId?: string;
};

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly rbacService: RbacService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractFromCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Permissions are resolved fresh from the DB on every request rather than
   * trusted from the token payload. Two reasons: (1) a role with a large
   * permission set (SUPER_ADMIN/COMPANY_ADMIN, 140+ keys after Phase 10)
   * serialized into the JWT pushes the `access_token` cookie past the
   * ~4KB per-cookie limit that browsers (and curl) silently enforce —
   * the cookie never gets stored at all, breaking cookie-based login for
   * exactly the highest-privilege roles; (2) as a side benefit, revoking a
   * role now takes effect on the very next request instead of only after
   * the token is refreshed.
   *
   * Phase 11 — companyId (tenant) is resolved fresh here too, same
   * reasoning: never trusted from the token, always the current DB state.
   * A STAFF identity's tenant is Staff.companyId (required, always set);
   * a CUSTOMER's is Customer.companyId (also required as of Phase 11 —
   * see the Customer model's own doc comment).
   */
  private async resolveCompanyId(
    identityId: string,
    type: IdentityType,
  ): Promise<string | null> {
    if (type === IdentityType.STAFF) {
      const staff = await this.prisma.staff.findUnique({
        where: { identityId },
        select: { companyId: true },
      });
      return staff?.companyId ?? null;
    }
    if (type === IdentityType.CUSTOMER) {
      const customer = await this.prisma.customer.findUnique({
        where: { identityId },
        select: { companyId: true },
      });
      return customer?.companyId ?? null;
    }
    return null;
  }

  /** Best-effort — a session's "last seen" timestamp is a convenience for
   * the user's own session list, never something a request should fail
   * over. Fire-and-forget rather than awaited, and any error is swallowed
   * rather than surfaced. */
  private bumpSessionActivity(sessionId: string): void {
    this.prisma.refreshToken
      .update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
      })
      .catch(() => {
        // Stale/rotated/deleted session id — nothing to update, nothing to report.
      });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthContext> {
    const [{ permissions }, companyId] = await Promise.all([
      this.rbacService.getEffectiveAccess(payload.sub),
      this.resolveCompanyId(payload.sub, payload.type),
    ]);
    if (payload.sessionId) {
      this.bumpSessionActivity(payload.sessionId);
    }
    return {
      ...payload,
      permissions,
      companyId,
      sessionId: payload.sessionId ?? null,
    };
  }
}
