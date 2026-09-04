import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { HotelReportsService } from './hotel-reports.service';

@Controller('hotels/reports')
@RequirePermissions(PERMISSIONS.HOTEL.REPORTS_VIEW)
export class HotelReportsController {
  constructor(private readonly reportsService: HotelReportsService) {}

  @Get('kpis')
  kpis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.reportsService.kpis({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
    });
  }

  @Get('profit')
  profit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.reportsService.profitReport({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
    });
  }
}
