import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { DailyClosingService } from './daily-closing.service';

@Controller('finance/daily-closing')
@RequirePermissions(PERMISSIONS.FINANCE.DAILY_CLOSING)
export class DailyClosingController {
  constructor(
    private readonly service: DailyClosingService,
    private readonly usersService: UsersService,
  ) {}

  @Get('preview')
  preview(@Query('businessDate') businessDate?: string) {
    return this.service.preview(
      businessDate ? new Date(businessDate) : new Date(),
    );
  }

  @Get()
  listAll(@Query('branchId') branchId?: string) {
    return this.service.listAll({ branchId });
  }

  @Post()
  async close(
    @CurrentUser() user: AuthContext,
    @Body() body: { businessDate?: string; branchId?: string },
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can close a business day');
    }
    return this.service.close(
      body.businessDate ? new Date(body.businessDate) : new Date(),
      staffId,
      body.branchId,
      user.sub,
    );
  }
}
