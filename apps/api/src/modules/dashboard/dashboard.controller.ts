import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  @RequirePermissions(PERMISSIONS.FINANCE.DASHBOARD_VIEW)
  kpis(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboardService.getKpis(resolveTenantFilter(user), {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  /** Spec #44 — every result type here is already gated by the caller
   * holding SEARCH.GLOBAL; a real per-record permission check (e.g. can
   * this caller actually read THIS customer) still applies wherever they
   * click through to the full record, same as any other list view. */
  @Get('search')
  @RequirePermissions(PERMISSIONS.SEARCH.GLOBAL)
  search(@CurrentUser() user: AuthContext, @Query('q') q: string) {
    return this.dashboardService.globalSearch(
      q ?? '',
      resolveTenantFilter(user),
    );
  }
}
