import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CampaignsService } from './campaigns.service';

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
    @Body()
    body: {
      name: string;
      description?: string;
      targetService: string;
      targetAudience?: string;
      startDate: string;
      endDate?: string;
      budget?: number;
      channel?: string;
    },
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.campaignsService.create({
      ...body,
      createdByStaffId: staffId ?? undefined,
    });
  }

  @Get()
  listAll(@Query('status') status?: CampaignStatus) {
    return this.campaignsService.listAll({ status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaignsService.get(id);
  }

  @Post(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: CampaignStatus },
  ) {
    return this.campaignsService.updateStatus(id, body.status);
  }
}
