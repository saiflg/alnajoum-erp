import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthContext } from '../interfaces/auth-context.interface';

/**
 * Step-up authentication (Phase 22): actions that move money, change who has access, or touch every
 * customer's data are not authorised by a session alone. A stolen or left-open session still has to
 * re-prove the password (or a two-factor code) to do them, and the proof lasts five minutes.
 *
 *   @RequireStepUp()   on the route
 *   POST /security/step-up {password | code}  ->  { stepUpToken, expiresInSeconds }
 *   send the token back in the `X-Step-Up-Token` header (the web app does this transparently)
 */
export const STEP_UP_KEY = 'requireStepUp';
export const STEP_UP_AUDIENCE = 'step-up';
export const STEP_UP_TTL_SECONDS = 300;
export const STEP_UP_HEADER = 'x-step-up-token';

export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

/** 403 with a machine-readable code, so a client knows to ask the user to confirm and retry. */
export class StepUpRequiredException extends ForbiddenException {
  constructor() {
    super({
      message: 'Please confirm your identity to continue with this action.',
      code: 'STEP_UP_REQUIRED',
    });
  }
}

@Injectable()
export class StepUpGuard implements CanActivate {
  private readonly jwt: JwtService;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthContext | undefined;
    if (!user) return true; // authentication decides access; there is nobody to step up

    const token = request.headers[STEP_UP_HEADER];
    if (typeof token !== 'string' || token.length === 0)
      throw new StepUpRequiredException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; aud: string }>(
        token,
        {
          audience: STEP_UP_AUDIENCE,
        },
      );
      // Proof belongs to THIS person: a token someone else obtained is worthless here.
      if (payload.sub !== user.sub) throw new StepUpRequiredException();
    } catch {
      throw new StepUpRequiredException();
    }
    return true;
  }
}
