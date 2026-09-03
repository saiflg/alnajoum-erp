import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IncentiveStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RejectIncentiveDto } from './dto/reject-incentive.dto';
import { VisaIncentivesService } from './visa-incentives.service';

@Controller('visa/incentives')
export class VisaIncentivesController {
  constructor(
    private readonly visaIncentivesService: VisaIncentivesService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  list(
    @Query('staffId') staffId?: string,
    @Query('status') status?: IncentiveStatus,
  ) {
    return this.visaIncentivesService.listAll({ staffId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_VIEW)
  get(@Param('id') id: string) {
    return this.visaIncentivesService.get(id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_APPROVE)
  async approve(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.requireStaffId(user);
    return this.visaIncentivesService.approve(id, staffId);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.VISA.INCENTIVE_APPROVE)
  async reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RejectIncentiveDto,
  ) {
    await this.requireStaffId(user);
    return this.visaIncentivesService.reject(id, dto.reason, user.sub);
  }
}
