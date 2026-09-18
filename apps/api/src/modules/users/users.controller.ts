import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { IncentivesService } from '../incentives/incentives.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffIdCardService } from './staff-id-card.service';
import { UsersService } from './users.service';

@Controller('staff')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly incentivesService: IncentivesService,
    private readonly staffIdCardService: StaffIdCardService,
  ) {}

  /** Incentives earned by the calling staff member from their own approved transactions. */
  @Get('me/incentives')
  async myIncentives(@CurrentUser() user: AuthContext) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) return [];
    return this.incentivesService.listForStaff(staffId);
  }

  /** Self-service printable ID badge — no extra permission beyond having a
   * staff record at all, same as GET me/incentives above. */
  @Get('me/id-card')
  async myIdCard(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new NotFoundException('No staff record for this account');
    }
    const { stream, filename } =
      await this.staffIdCardService.renderIdCard(staffId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  /** Public badge-verification lookup by employee code, for whoever scans
   * the QR — the same info already printed on the card, plus a live
   * active/inactive flag so a deactivated badge reads as invalid the
   * moment it's scanned, even though the physical card hasn't changed. */
  @Public()
  @Get('verify/:employeeCode')
  verify(@Param('employeeCode') employeeCode: string) {
    return this.staffIdCardService.getVerification(employeeCode);
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

  @Get(':id/id-card')
  @RequirePermissions(PERMISSIONS.STAFF.READ)
  async idCard(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } = await this.staffIdCardService.renderIdCard(
      id,
      resolveTenantFilter(user),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(stream);
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
