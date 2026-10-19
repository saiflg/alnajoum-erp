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
import { RequireStepUp } from '../../common/security/step-up';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { IncentivesService } from '../incentives/incentives.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ChangeStaffRoleDto, TransferStaffDto } from './dto/staff-moves.dto';
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
    return this.usersService.createStaff(dto, resolveTenantFilter(user), {
      sub: user.sub,
      roles: user.roles,
    });
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

  /** "Deleting" staff removes their access and keeps their history; see UsersService.remove. */
  @RequireStepUp()
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STAFF.DELETE)
  remove(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.usersService.remove(
      id,
      resolveTenantFilter(user),
      user.sub,
      reason?.slice(0, 300),
    );
  }

  /** Issues a new temporary password; shown once to the administrator. See UsersService.resetPassword. */
  @RequireStepUp()
  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.STAFF.RESET_PASSWORD)
  resetPassword(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.usersService.resetPassword(id, resolveTenantFilter(user), {
      sub: user.sub,
      roles: user.roles,
    });
  }

  /** Moves the person to another branch of their company. */
  @RequireStepUp()
  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.STAFF.TRANSFER)
  transfer(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: TransferStaffDto,
  ) {
    return this.usersService.transfer(id, dto, resolveTenantFilter(user), {
      sub: user.sub,
      roles: user.roles,
    });
  }

  /** Promotes or demotes: replaces the person's role. */
  @RequireStepUp()
  @Post(':id/role')
  @RequirePermissions(PERMISSIONS.STAFF.CHANGE_ROLE)
  changeRole(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ChangeStaffRoleDto,
  ) {
    return this.usersService.changeRole(id, dto, resolveTenantFilter(user), {
      sub: user.sub,
      roles: user.roles,
    });
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  history(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.usersService.history(id, resolveTenantFilter(user));
  }

  @RequireStepUp()
  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.STAFF.DELETE)
  reactivate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.usersService.reactivate(
      id,
      resolveTenantFilter(user),
      user.sub,
    );
  }
}
