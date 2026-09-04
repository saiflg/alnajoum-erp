import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  TicketMessageAuthorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { SupportTicketsService } from './support-tickets.service';

@Controller('support/tickets')
@RequirePermissions(PERMISSIONS.SUPPORT.TICKET_VIEW)
export class SupportTicketsAdminController {
  constructor(
    private readonly ticketsService: SupportTicketsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  listAll(
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.ticketsService.listAll({
      status,
      priority,
      assignedStaffId,
      branchId,
      categoryId,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.ticketsService.get(id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.SUPPORT.TICKET_MANAGE)
  async assign(
    @Param('id') id: string,
    @Body() body: { staffId: string; branchId?: string },
  ) {
    return this.ticketsService.assign(id, body.staffId, body.branchId);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.SUPPORT.TICKET_MANAGE)
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: TicketStatus },
  ) {
    if (body.status === TicketStatus.RESOLVED) {
      return this.ticketsService.resolve(id);
    }
    return this.ticketsService.updateStatus(id, body.status);
  }

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
