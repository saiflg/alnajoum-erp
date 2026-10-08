import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import {
  STEP_UP_AUDIENCE,
  STEP_UP_TTL_SECONDS,
} from '../../common/security/step-up';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from '../auth/two-factor.service';

/**
 * Issues the short-lived proof that StepUpGuard checks. An account with two-factor on must supply a code
 * (a password alone is not enough - that is the point of having two-factor); any other account supplies its
 * password. Failures are audited, and the endpoint carries the credential rate limit.
 */
@Injectable()
export class StepUpService {
  private readonly jwt: JwtService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly twoFactor: TwoFactorService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async issue(
    identityId: string,
    proof: { password?: string; code?: string },
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity || identity.status !== 'ACTIVE')
      throw new UnauthorizedException('This account is not active');

    let ok = false;
    if (identity.twoFactorEnabled) {
      if (!proof.code)
        throw new BadRequestException(
          'Enter your authenticator or recovery code',
        );
      ok = await this.twoFactor.verifyChallenge(identityId, proof.code);
    } else {
      if (!proof.password) throw new BadRequestException('Enter your password');
      ok = await argon2.verify(identity.passwordHash, proof.password);
    }
    if (!ok) {
      await this.audit.record({
        identityId,
        action: 'security.step_up_failed',
        entityType: 'Identity',
        entityId: identityId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('That did not match. Try again.');
    }

    const stepUpToken = await this.jwt.signAsync(
      { sub: identityId },
      { audience: STEP_UP_AUDIENCE, expiresIn: STEP_UP_TTL_SECONDS },
    );
    return { stepUpToken, expiresInSeconds: STEP_UP_TTL_SECONDS };
  }
}
