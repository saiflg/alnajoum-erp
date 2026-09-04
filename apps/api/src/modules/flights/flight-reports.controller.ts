import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { FlightReportsService } from './flight-reports.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';

@Controller('flights/reports')
@RequirePermissions(PERMISSIONS.FLIGHT.REPORTS_VIEW)
export class FlightReportsController {
  constructor(
    private readonly reportsService: FlightReportsService,
    private readonly providerLog: ProviderTransactionLogService,
  ) {}

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

  @Get('provider-logs')
  providerLogs(
    @Query('provider')
    provider?: 'MOCK' | 'DUFFEL' | 'SABRE' | 'AMADEUS' | 'TRAVELPORT' | 'TBO',
  ) {
    return this.providerLog.listAll({ provider });
  }
}
