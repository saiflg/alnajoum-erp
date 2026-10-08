import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext } from '../interfaces/auth-context.interface';
import { resolveTenantFilter } from '../utils/tenant.util';
import { TENANT_SCOPED_KEY, TenantScopeSpec } from './tenant-scoped.decorator';
import { TenantGuardService } from './tenant-guard.service';

/**
 * Enforces `@TenantScoped(...)`. Runs after authentication, role and permission guards, so a caller
 * without the permission is told 403 as before and only an authorised caller reaches the tenant check.
 */
@Injectable()
export class TenantResourceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantGuard: TenantGuardService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const specs = this.reflector.getAllAndMerge<TenantScopeSpec[]>(
      TENANT_SCOPED_KEY,
      [context.getClass(), context.getHandler()],
    );
    if (!specs || specs.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthContext | undefined;
    if (!user) return true; // public route: nothing to scope to (authentication decides access)
    const tenant = resolveTenantFilter(user);
    if (tenant === undefined) return true; // SUPER_ADMIN

    for (const spec of specs) {
      const bag = (request[spec.source ?? 'params'] ?? {}) as Record<
        string,
        unknown
      >;
      const value = bag[spec.param ?? 'id'];
      const kind = spec.kindBy
        ? spec.kindBy.map[String(request.params?.[spec.kindBy.param])]
        : spec.kind;
      if (kind && typeof value === 'string' && value.length > 0) {
        await this.tenantGuard.assert(kind, value, tenant);
      }
    }
    return true;
  }
}
