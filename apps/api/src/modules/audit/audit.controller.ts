import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT.READ)
  list(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.auditService.listForEntity(entityType, entityId);
  }

  /** Phase 11 spec #26 — the general admin audit-search endpoint, distinct
   * from the narrower `GET /audit-logs` "one entity's history" lookup
   * above (kept as-is since every existing caller already uses it). */
  @Get('search')
  @RequirePermissions(PERMISSIONS.AUDIT.READ)
  search(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('identityId') identityId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('ipAddress') ipAddress?: string,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.auditService.search(
      {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        identityId,
        action,
        entityType,
        entityId,
        ipAddress,
        branchId,
        limit: limit ? Number(limit) : undefined,
        cursor,
      },
      resolveTenantFilter(user),
    );
  }
}
