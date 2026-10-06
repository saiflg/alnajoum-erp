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
  profitAndLoss(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.profitAndLoss(user, this.range(from, to));
  }

  @Get('cash-flow')
  cashFlow(
    @CurrentUser() user: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.cashFlow(user, this.range(from, to));
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthContext) {
    return this.reportsService.dashboardKpis(user);
  }

  @Get('branches')
  branches(@CurrentUser() user: AuthContext) {
    return this.reportsService.branchAccounting(user);
  }

  @Get('customer-statement/:customerId')
  customerStatement(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.customerStatement(
      user,
      customerId,
      this.range(from, to),
    );
  }

  @Get('staff-incentive-statement/:staffId')
  staffIncentiveStatement(
    @CurrentUser() user: AuthContext,
    @Param('staffId') staffId: string,
  ) {
    return this.reportsService.staffIncentiveStatement(user, staffId);
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
    return this.reportsService.staffIncentiveStatement(user, staffId, true);
  }

  @Get('transaction/:sourceType/:sourceId')
  transactionProfitability(
    @CurrentUser() user: AuthContext,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.reportsService.transactionProfitability(
      user,
      sourceType,
      sourceId,
    );
  }
}
