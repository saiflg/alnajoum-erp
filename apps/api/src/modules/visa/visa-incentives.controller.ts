import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IncentiveStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RejectIncentiveDto } from './dto/reject-incentive.dto';
import { VisaIncentivesService } from './visa-incentives.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
@RequireFeature('ENABLE_VISA')
@Controller('visa/incentives')
export class VisaIncentivesController {
  constructor(
    private readonly visaIncentivesService: VisaIncentivesService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  list(
    @CurrentUser() user: AuthContext,
    @Query('staffId') staffId?: string,
    @Query('status') status?: IncentiveStatus,
  ) {
    return this.visaIncentivesService.listAll(
      { staffId, status },
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIncentive')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  get(@Param('id') id: string) {
    return this.visaIncentivesService.get(id);
  }

  @TenantScoped('staffIncentive')
  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_APPROVE)
  async approve(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.requireStaffId(user);
    return this.visaIncentivesService.approve(id, staffId, user.permissions);
  }

  @TenantScoped('staffIncentive')
  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_APPROVE)
  async reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RejectIncentiveDto,
  ) {
    await this.requireStaffId(user);
    return this.visaIncentivesService.reject(id, dto.reason, user.sub);
  }
}
