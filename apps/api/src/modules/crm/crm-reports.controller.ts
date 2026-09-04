import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CrmReportsService } from './crm-reports.service';

@Controller('crm/reports')
export class CrmReportsController {
  constructor(
    private readonly reportsService: CrmReportsService,
    private readonly usersService: UsersService,
  ) {}

  private range(from?: string, to?: string) {
    return {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };
  }

  @Get('staff/me')
  async myPerformance(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff have a performance report');
    }
    return this.reportsService.staffPerformance(staffId, this.range(from, to));
  }

  @Get('staff/:staffId')
  @RequirePermissions(PERMISSIONS.CRM.DASHBOARD_VIEW)
  staffPerformance(
    @Param('staffId') staffId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.staffPerformance(staffId, this.range(from, to));
  }

  @Get('customer-value/:customerId')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_360_VIEW)
  customerValue(@Param('customerId') customerId: string) {
    return this.reportsService.customerValue(customerId);
  }

  @Get('dashboard/me')
  async myDashboard(@CurrentUser() user: AuthContext) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff have a CRM dashboard');
    }
    return this.reportsService.staffDashboard(staffId);
  }

  @Get('dashboard/branch/:branchId')
  @RequirePermissions(PERMISSIONS.CRM.DASHBOARD_VIEW)
  branchDashboard(@Param('branchId') branchId: string) {
    return this.reportsService.branchDashboard(branchId);
  }

  @Get('dashboard/company')
  @RequirePermissions(PERMISSIONS.CRM.DASHBOARD_VIEW)
  companyDashboard() {
    return this.reportsService.companyDashboard();
  }
}
