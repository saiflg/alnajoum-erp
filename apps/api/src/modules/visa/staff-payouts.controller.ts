import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';
import { StaffPayoutsService } from './staff-payouts.service';

@Controller('visa/payouts')
export class StaffPayoutsController {
  constructor(
    private readonly staffPayoutsService: StaffPayoutsService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  /** Required before a payout can succeed — see StaffPayoutsService.attemptPayout(). */
  @Patch('me/bank-details')
  async updateMyBankDetails(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateBankDetailsDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff have bank details on file');
    }
    // Phase 6 spec #12: any change to the account itself invalidates the
    // previous verification — Finance must re-verify (see
    // FinanceStaffBankAccountsController) before the next payout attempt,
    // which StaffPayoutsService.attemptPayout() now checks for.
    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        ...dto,
        bankAccountVerified: false,
        bankAccountVerifiedAt: null,
        bankAccountVerifiedByStaffId: null,
      },
    });
    return { updated: true };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.PAYOUT_APPROVE)
  list(
    @Query('staffId') staffId?: string,
    @Query('status') status?: PayoutStatus,
  ) {
    return this.staffPayoutsService.listAll({ staffId, status });
  }

  @Post(':incentiveId/pay')
  @RequirePermissions(PERMISSIONS.VISA.PAYOUT_APPROVE)
  async pay(
    @CurrentUser() user: AuthContext,
    @Param('incentiveId') incentiveId: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can request a payout');
    }
    return this.staffPayoutsService.attemptPayout(incentiveId, staffId);
  }

  @Post(':incentiveId/retry')
  @RequirePermissions(PERMISSIONS.VISA.PAYOUT_APPROVE)
  async retry(
    @CurrentUser() user: AuthContext,
    @Param('incentiveId') incentiveId: string,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can retry a payout');
    }
    return this.staffPayoutsService.retryPayout(incentiveId, staffId);
  }
}
