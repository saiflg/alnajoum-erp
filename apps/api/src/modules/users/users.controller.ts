import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { IncentivesService } from '../incentives/incentives.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UsersService } from './users.service';

@Controller('staff')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly incentivesService: IncentivesService,
  ) {}

  /** Incentives earned by the calling staff member from their own approved transactions. */
  @Get('me/incentives')
  async myIncentives(@CurrentUser() user: AuthContext) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) return [];
    return this.incentivesService.listForStaff(staffId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateStaffDto) {
    return this.usersService.createStaff(dto, resolveTenantFilter(user));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  findAll(
    @CurrentUser() user: AuthContext,
    @Query('branchId') branchId?: string,
  ) {
    return this.usersService.findAll(branchId, resolveTenantFilter(user));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.usersService.findOne(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STAFF.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.usersService.update(id, dto, resolveTenantFilter(user));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STAFF.DELETE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.usersService.remove(id, resolveTenantFilter(user));
  }
}
