import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CampaignsService } from './campaigns.service';

import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { CampaignCreateDto, CampaignStatusDto } from './dto/crm-bodies.dto';
@Controller('crm/campaigns')
@RequirePermissions(PERMISSIONS.CRM.CAMPAIGN_MANAGE)
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() body: CampaignCreateDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.campaignsService.create({
      ...body,
      createdByStaffId: staffId ?? undefined,
    });
  }

  @Get()
  listAll(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: CampaignStatus,
  ) {
    return this.campaignsService.listAll({ status }, resolveTenantFilter(user));
  }

  @TenantScoped('campaign')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaignsService.get(id);
  }

  @TenantScoped('campaign')
  @Post(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: CampaignStatusDto) {
    return this.campaignsService.updateStatus(id, body.status);
  }
}
