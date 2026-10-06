import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { FlightReportsService } from './flight-reports.service';

@Controller('flights/reports')
@RequirePermissions(PERMISSIONS.FLIGHT.REPORTS_VIEW)
export class FlightReportsController {
  constructor(private readonly reportsService: FlightReportsService) {}

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

  @Get('provider-logs')
  providerLogs(
    @CurrentUser() user: AuthContext,
    @Query('provider')
    provider?: 'MOCK' | 'DUFFEL' | 'SABRE' | 'AMADEUS' | 'TRAVELPORT' | 'TBO',
  ) {
    return this.reportsService.providerLogs(user, provider);
  }
}
