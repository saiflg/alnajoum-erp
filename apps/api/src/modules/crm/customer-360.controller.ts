import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Delete,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { Customer360Service } from './customer-360.service';

@Controller('crm/customers')
@RequirePermissions(PERMISSIONS.CRM.CUSTOMER_360_VIEW)
export class Customer360Controller {
  constructor(
    private readonly service: Customer360Service,
    private readonly usersService: UsersService,
  ) {}

  @Get('search')
  @RequirePermissions(PERMISSIONS.CRM.SEARCH)
  search(@Query('q') q: string) {
    return this.service.search(q ?? '');
  }

  @Get('tags')
  listTags() {
    return this.service.listTags();
  }

  @Post('tags')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_TAG_MANAGE)
  createTag(@Body() body: { name: string }) {
    return this.service.createTag(body.name);
  }

  @Get(':id')
  getProfile(@Param('id') id: string) {
    return this.service.getProfile(id);
  }

  @Get(':id/bookings')
  getBookings(@Param('id') id: string) {
    return this.service.getBookings(id);
  }

  @Get(':id/financials')
  @RequirePermissions(PERMISSIONS.FINANCE.DASHBOARD_VIEW)
  getFinancials(@Param('id') id: string) {
    return this.service.getFinancials(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string) {
    return this.service.timeline(id);
  }

  @Get(':id/segments')
  segments(@Param('id') id: string) {
    return this.service.segments(id);
  }

  @Get(':id/notes')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_NOTE_MANAGE)
  listNotes(@Param('id') id: string) {
    return this.service.listNotes(id);
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_NOTE_MANAGE)
  async addNote(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can add a customer note');
    }
    return this.service.addNote(id, body.note, staffId);
  }

  @Post(':id/tags/:tagId')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_TAG_MANAGE)
  async assignTag(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.assignTag(id, tagId, staffId ?? undefined);
  }

  @Delete(':id/tags/:tagId')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_TAG_MANAGE)
  removeTag(@Param('id') id: string, @Param('tagId') tagId: string) {
    return this.service.removeTag(id, tagId);
  }
}
