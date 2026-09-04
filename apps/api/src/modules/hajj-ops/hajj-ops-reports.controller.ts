import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { HajjOpsReportsService } from './hajj-ops-reports.service';

@Controller('hajj-ops/reports')
export class HajjOpsReportsController {
  constructor(private readonly service: HajjOpsReportsService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.DASHBOARD_VIEW)
  dashboard() {
    return this.service.dashboard();
  }

  @Get('profitability/hajj/:packageId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.PROFITABILITY_VIEW)
  hajjProfitability(@Param('packageId') packageId: string) {
    return this.service.hajjPackageProfitability(packageId);
  }

  @Get('profitability/umrah/:packageId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.PROFITABILITY_VIEW)
  umrahProfitability(@Param('packageId') packageId: string) {
    return this.service.umrahPackageProfitability(packageId);
  }
}
