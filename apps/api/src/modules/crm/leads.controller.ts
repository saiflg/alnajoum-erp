import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

@Controller('crm/leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.LEAD_CREATE)
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateLeadDto) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.leadsService.create(dto, staffId ?? undefined);
  }

  /**
   * Spec #31's data-isolation: plain STAFF only ever sees their own leads
   * unless the caller also holds LEAD_MANAGE (Branch Manager+), which
   * unlocks the full filterable list — same "own vs everything" split as
   * CustomersService.findMyCustomers/findAll.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.CRM.LEAD_READ)
  async listAll(
    @CurrentUser() user: AuthContext,
    @Query('stageId') stageId?: string,
    @Query('status') status?: LeadStatus,
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('assignedBranchId') assignedBranchId?: string,
  ) {
    const canManage = user.permissions.includes(PERMISSIONS.CRM.LEAD_MANAGE);
    let scopedStaffId = assignedStaffId;
    if (!canManage) {
      scopedStaffId =
        (await this.usersService.getStaffIdForIdentity(user.sub)) ?? undefined;
    }
    return this.leadsService.listAll({
      stageId,
      status,
      assignedStaffId: scopedStaffId,
      assignedBranchId,
    });
  }

  @Get('stages')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_READ)
  listStages() {
    return this.leadsService.listStages();
  }

  @Post('stages')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_STAGE_MANAGE)
  createStage(@Body() body: { name: string; order: number }) {
    return this.leadsService.createStage(body.name, body.order);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_READ)
  get(@Param('id') id: string) {
    return this.leadsService.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Post(':id/stage')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_MANAGE)
  async changeStage(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { stageId: string },
  ) {
    const staffId = await this.requireStaffId(user);
    return this.leadsService.changeStage(id, body.stageId, staffId);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_MANAGE)
  async assign(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { staffId?: string; method?: 'ROUND_ROBIN' },
  ) {
    const staffId = await this.requireStaffId(user);
    const targetStaffId =
      body.method === 'ROUND_ROBIN'
        ? await this.leadsService.assignRoundRobin()
        : body.staffId;
    if (!targetStaffId) {
      throw new ForbiddenException('Provide a staffId or an assignment method');
    }
    return this.leadsService.assign(id, targetStaffId, staffId);
  }

  @Post(':id/lost')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_MANAGE)
  async markLost(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const staffId = await this.requireStaffId(user);
    return this.leadsService.markLost(id, body.reason, staffId);
  }

  @Post(':id/convert')
  @RequirePermissions(PERMISSIONS.CRM.LEAD_MANAGE)
  async convert(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body()
    body: {
      existingCustomerId?: string;
      mode?: 'CUSTOMER' | 'CORPORATE' | 'FAMILY';
    },
  ) {
    const staffId = await this.requireStaffId(user);
    return this.leadsService.convert(id, { ...body, actorStaffId: staffId });
  }
}
