import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { RbacService } from '../../rbac/rbac.service';

function extractFromCookie(req: Request): string | null {
  const token = req?.cookies?.access_token as string | undefined;
  return token ?? null;
}

/** What's actually signed into the access token — see AuthService.issueTokenPair.
 * `permissions` is deliberately NOT here (see validate() below for why). */
type AccessTokenPayload = Pick<AuthContext, 'sub' | 'type' | 'roles'>;

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly rbacService: RbacService,
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
   */
  async validate(payload: AccessTokenPayload): Promise<AuthContext> {
    const { permissions } = await this.rbacService.getEffectiveAccess(
      payload.sub,
    );
    return { ...payload, permissions };
  }
}
