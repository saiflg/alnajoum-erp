import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { FeatureFlagsService } from '../../modules/governance/feature-flags.service';
import { FEATURE_FLAG_KEY } from '../decorators/require-feature.decorator';
import { AuthContext } from '../interfaces/auth-context.interface';

/**
 * Spec #39's "wire flags into real gates" — the enforcement half of
 * FeatureFlagsService.isEnabled(), which existed all of Phase 11 with no
 * call site. A disabled flag is a 403 (not 404): unlike a cross-tenant id,
 * there's nothing secret about a feature being turned off, so the caller
 * is told plainly rather than being made to guess. Never a substitute for
 * @RequirePermissions/@Roles — this only asks "is the feature on," not
 * "is this caller allowed," and it runs after those guards in the global
 * order (app.module.ts) so an unauthorized caller never reaches it.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!key) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthContext | undefined;
    // A caller with no resolvable company (SUPER_ADMIN, or an
    // unauthenticated @Public() request) falls back to the flag's
    // platform-wide default — same reasoning as resolveTenantFilter.
    const companyId = user?.companyId ?? null;

    const enabled = await this.featureFlagsService.isEnabled(key, companyId);
    if (!enabled) {
      throw new ForbiddenException(
        `This feature ("${key}") is not enabled for your account`,
      );
    }
    return true;
  }
}
