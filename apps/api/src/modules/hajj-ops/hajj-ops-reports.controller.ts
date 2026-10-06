import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { HajjOpsReportsService } from './hajj-ops-reports.service';

@Controller('hajj-ops/reports')
export class HajjOpsReportsController {
  constructor(private readonly service: HajjOpsReportsService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.DASHBOARD_VIEW)
  dashboard(@CurrentUser() user: AuthContext) {
    return this.service.dashboard(user);
  }

  @Get('profitability/hajj/:packageId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.PROFITABILITY_VIEW)
  hajjProfitability(
    @CurrentUser() user: AuthContext,
    @Param('packageId') packageId: string,
  ) {
    return this.service.hajjPackageProfitability(user, packageId);
  }

  @Get('profitability/umrah/:packageId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.PROFITABILITY_VIEW)
  umrahProfitability(
    @CurrentUser() user: AuthContext,
    @Param('packageId') packageId: string,
  ) {
    return this.service.umrahPackageProfitability(user, packageId);
  }
}
