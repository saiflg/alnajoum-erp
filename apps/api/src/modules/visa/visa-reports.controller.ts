import { Controller, Get, Query } from '@nestjs/common';
import { VisaApplicationStatus, VisaType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { VisaReportsService } from './visa-reports.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@RequireFeature('ENABLE_VISA')
@Controller('visa/reports')
export class VisaReportsController {
  constructor(private readonly visaReportsService: VisaReportsService) {}

  @Get('profit')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  profitReport(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
    @Query('country') country?: string,
  ) {
    return this.visaReportsService.profitReport(user, {
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
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
    @Query('country') country?: string,
    @Query('visaType') visaType?: VisaType,
  ) {
    return this.visaReportsService.kpis(user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
      country,
      visaType,
    });
  }

  @Get('status-breakdown')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  statusBreakdown(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('staffId') staffId?: string,
    @Query('country') country?: string,
    @Query('visaType') visaType?: VisaType,
    @Query('customerId') customerId?: string,
    @Query('status') status?: VisaApplicationStatus,
  ) {
    return this.visaReportsService.statusBreakdown(user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      staffId,
      country,
      visaType,
      customerId,
      status,
    });
  }
}
