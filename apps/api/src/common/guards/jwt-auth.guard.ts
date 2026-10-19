import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthContext } from '../interfaces/auth-context.interface';

/** What a person who must still replace a temporary password may do: that, see who they are, and sign out. */
export const PASSWORD_CHANGE_ALLOWED_PATHS = [
  '/auth/change-password',
  '/auth/me',
  '/auth/logout',
  '/auth/refresh',
];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthContext>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const authenticated: TUser = super.handleRequest<TUser>(
      err,
      user,
      info,
      context,
    );
    if ((authenticated as AuthContext | undefined)?.mustChangePassword) {
      const path = String(
        context.switchToHttp().getRequest<{ path?: string }>().path ?? '',
      );
      if (!PASSWORD_CHANGE_ALLOWED_PATHS.some((p) => path.endsWith(p))) {
        throw new ForbiddenException({
          message: 'You must choose a new password before you continue.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
    }
    return authenticated;
  }
}
