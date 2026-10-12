import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  parseListPage,
  withPageHeaders,
} from '../../common/pagination/list-page';
import {
  TicketMessageAuthorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { SupportTicketsService } from './support-tickets.service';

import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { TicketAssignDto, TicketStatusDto } from './dto/support-bodies.dto';
@Controller('support/tickets')
@RequirePermissions(PERMISSIONS.SUPPORT.TICKET_VIEW)
export class SupportTicketsAdminController {
  constructor(
    private readonly ticketsService: SupportTicketsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async listAll(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tenant = resolveTenantFilter(user);
    const page = parseListPage(limit, offset);
    const filters = { status, priority, assignedStaffId, branchId, categoryId };
    const rows = await this.ticketsService.listAll(filters, tenant, page);
    return withPageHeaders(res, rows, page, () =>
      this.ticketsService.countAll(filters, tenant),
    );
  }

  @TenantScoped('supportTicket')
  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.ticketsService.get(id, resolveTenantFilter(user));
  }

  @TenantScoped('supportTicket')
  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.SUPPORT.TICKET_MANAGE)
  async assign(@Param('id') id: string, @Body() body: TicketAssignDto) {
    return this.ticketsService.assign(id, body.staffId, body.branchId);
  }

  @TenantScoped('supportTicket')
  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.SUPPORT.TICKET_MANAGE)
  updateStatus(@Param('id') id: string, @Body() body: TicketStatusDto) {
    if (body.status === TicketStatus.RESOLVED) {
      return this.ticketsService.resolve(id);
    }
    return this.ticketsService.updateStatus(id, body.status);
  }

  @TenantScoped('supportTicket')
  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.SUPPORT.TICKET_MANAGE)
  async addMessage(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can reply to a ticket');
    }
    return this.ticketsService.addMessage(
      id,
      dto.message,
      TicketMessageAuthorType.STAFF,
      staffId,
      dto.isInternal ?? false,
    );
  }
}
