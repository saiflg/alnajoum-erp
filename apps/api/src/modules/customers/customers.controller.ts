import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CustomersService } from './customers.service';
import { AdminUpdateCustomerDto } from './dto/admin-update-customer.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  findAll(
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('assignedBranchId') assignedBranchId?: string,
  ) {
    return this.customersService.findAll({ assignedStaffId, assignedBranchId });
  }

  /** Every customer assigned to the calling staff member — "my customers". */
  @Get('assigned-to-me')
  @RequirePermissions(PERMISSIONS.STAFF_ASSIGNMENT.READ)
  async findAssignedToMe(@CurrentUser() user: AuthContext) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) return [];
    return this.customersService.listForStaff(staffId);
  }

  @Get('me')
  getOwnProfile(@CurrentUser() user: AuthContext) {
    return this.customersService.findByIdentityId(user.sub);
  }

  @Patch('me')
  updateOwnProfile(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.customersService.updateByIdentityId(user.sub, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AdminUpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.customersService.deactivate(id, user.sub);
  }
}
