import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApprovalRequestStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalRequestDto } from './dto/decide-approval-request.dto';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  /** A caller can always see their own requests, regardless of APPROVAL.VIEW. */
  @Get('mine')
  listMine(@CurrentUser() user: AuthContext) {
    return this.approvalsService.listMine(user.sub);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.APPROVAL.VIEW)
  list(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: ApprovalRequestStatus,
    @Query('type') type?: string,
  ) {
    return this.approvalsService.list(
      { status, type },
      resolveTenantFilter(user),
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPROVAL.VIEW)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.approvalsService.findOne(id, resolveTenantFilter(user));
  }

  @Post(':id/decide')
  @RequirePermissions(PERMISSIONS.APPROVAL.DECIDE)
  decide(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: DecideApprovalRequestDto,
  ) {
    return this.approvalsService.decide(
      id,
      user.sub,
      dto.decision,
      dto.reason,
      resolveTenantFilter(user),
    );
  }
}
