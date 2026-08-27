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
  create(@Body() dto: CreateStaffDto) {
    return this.usersService.createStaff(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  findAll(
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.usersService.findAll(companyId, branchId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STAFF.UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STAFF.DELETE)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
