import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { HotelReportsService } from './hotel-reports.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@RequireFeature('ENABLE_HOTELS')
@Controller('hotels/reports')
@RequirePermissions(PERMISSIONS.HOTEL.REPORTS_VIEW)
export class HotelReportsController {
  constructor(private readonly reportsService: HotelReportsService) {}

  @Get('kpis')
  kpis(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.reportsService.kpis(user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
    });
  }

  @Get('profit')
  profit(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.reportsService.profitReport(user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
    });
  }
}
