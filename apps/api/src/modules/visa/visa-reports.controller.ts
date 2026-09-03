import { Controller, Get, Query } from '@nestjs/common';
import { VisaType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { VisaReportsService } from './visa-reports.service';

@Controller('visa/reports')
export class VisaReportsController {
  constructor(private readonly visaReportsService: VisaReportsService) {}

  @Get('profit')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  profitReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
    @Query('country') country?: string,
  ) {
    return this.visaReportsService.profitReport({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
      country,
    });
  }

  @Get('kpis')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  kpis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
    @Query('country') country?: string,
    @Query('visaType') visaType?: VisaType,
  ) {
    return this.visaReportsService.kpis({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
      country,
      visaType,
    });
  }
}
