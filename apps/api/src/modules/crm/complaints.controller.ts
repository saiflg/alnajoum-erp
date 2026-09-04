import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { ComplaintsService } from './complaints.service';

@Controller('crm/complaints')
export class ComplaintsController {
  constructor(
    private readonly complaintsService: ComplaintsService,
    private readonly customersService: CustomersService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Post('me')
  async createOwn(
    @CurrentUser() user: AuthContext,
    @Body() body: { subject: string; description: string },
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.complaintsService.create(
      customerId,
      body.subject,
      body.description,
    );
  }

  @Get('me')
  async listOwn(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.complaintsService.listForCustomer(customerId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  listAll(
    @Query('status') status?: ComplaintStatus,
    @Query('assignedStaffId') assignedStaffId?: string,
  ) {
    return this.complaintsService.listAll({ status, assignedStaffId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  get(@Param('id') id: string) {
    return this.complaintsService.get(id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  assign(@Param('id') id: string, @Body() body: { staffId: string }) {
    return this.complaintsService.assign(id, body.staffId);
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  async addNote(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { note: string; isInternal?: boolean },
  ) {
    const staffId = await this.requireStaffId(user);
    return this.complaintsService.addNote(
      id,
      body.note,
      staffId,
      body.isInternal ?? true,
    );
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  resolve(@Param('id') id: string, @Body() body: { resolution: string }) {
    return this.complaintsService.resolve(id, body.resolution);
  }

  @Post(':id/escalate')
  @RequirePermissions(PERMISSIONS.CRM.COMPLAINT_MANAGE)
  escalate(@Param('id') id: string, @Body() body: { toRole: string }) {
    return this.complaintsService.escalate(id, body.toRole);
  }
}
