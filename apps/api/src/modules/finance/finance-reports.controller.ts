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
import { FinanceReportsService } from './finance-reports.service';

@Controller('finance/reports')
@RequirePermissions(PERMISSIONS.FINANCE.DASHBOARD_VIEW)
export class FinanceReportsController {
  constructor(
    private readonly reportsService: FinanceReportsService,
    private readonly usersService: UsersService,
  ) {}

  private range(from?: string, to?: string) {
    return {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };
  }

  @Get('profit-and-loss')
  profitAndLoss(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.profitAndLoss(this.range(from, to));
  }

  @Get('cash-flow')
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.cashFlow(this.range(from, to));
  }

  @Get('dashboard')
  dashboard() {
    return this.reportsService.dashboardKpis();
  }

  @Get('branches')
  branches() {
    return this.reportsService.branchAccounting();
  }

  @Get('customer-statement/:customerId')
  customerStatement(
    @Param('customerId') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.customerStatement(
      customerId,
      this.range(from, to),
    );
  }

  @Get('staff-incentive-statement/:staffId')
  staffIncentiveStatement(@Param('staffId') staffId: string) {
    return this.reportsService.staffIncentiveStatement(staffId);
  }

  /**
   * Own statement — a staff member viewing their own incentive earnings.
   * The bare @RequirePermissions() (empty array) overrides the class-level
   * FINANCE.DASHBOARD_VIEW requirement — PermissionsGuard's
   * getAllAndUse picks the method-level decorator when present at all, so
   * any authenticated staff member reaches here; requireStaffId still
   * gates it to staff (never a customer/anonymous caller).
   */
  @Get('staff-incentive-statement/me')
  @RequirePermissions()
  async myIncentiveStatement(@CurrentUser() user: AuthContext) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff have an incentive statement');
    }
    return this.reportsService.staffIncentiveStatement(staffId);
  }

  @Get('transaction/:sourceType/:sourceId')
  transactionProfitability(
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.reportsService.transactionProfitability(sourceType, sourceId);
  }
}
