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
import { resolveTenantFilter } from '../../common/utils/tenant.util';
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
  search(@CurrentUser() user: AuthContext, @Query('q') q: string) {
    return this.service.search(q ?? '', resolveTenantFilter(user));
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
  getProfile(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.getProfile(id, resolveTenantFilter(user));
  }

  @Get(':id/bookings')
  getBookings(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.getBookings(id, resolveTenantFilter(user));
  }

  @Get(':id/financials')
  @RequirePermissions(PERMISSIONS.FINANCE.DASHBOARD_VIEW)
  getFinancials(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.getFinancials(id, resolveTenantFilter(user));
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.timeline(id, resolveTenantFilter(user));
  }

  @Get(':id/segments')
  segments(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.segments(id, resolveTenantFilter(user));
  }

  @Get(':id/notes')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_NOTE_MANAGE)
  listNotes(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.listNotes(id, resolveTenantFilter(user));
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
    return this.service.addNote(
      id,
      body.note,
      staffId,
      resolveTenantFilter(user),
    );
  }

  @Post(':id/tags/:tagId')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_TAG_MANAGE)
  async assignTag(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.assignTag(
      id,
      tagId,
      staffId ?? undefined,
      resolveTenantFilter(user),
    );
  }

  @Delete(':id/tags/:tagId')
  @RequirePermissions(PERMISSIONS.CRM.CUSTOMER_TAG_MANAGE)
  removeTag(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.service.removeTag(id, tagId, resolveTenantFilter(user));
  }
}
