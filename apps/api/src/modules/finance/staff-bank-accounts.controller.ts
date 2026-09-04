import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { StaffBankAccountsService } from './staff-bank-accounts.service';

/** Spec #12's Finance-side verification (the staff self-service update lives on StaffPayoutsController). */
@Controller('finance/staff-bank-accounts')
@RequirePermissions(PERMISSIONS.FINANCE.STAFF_BANK_VERIFY)
export class StaffBankAccountsController {
  constructor(
    private readonly service: StaffBankAccountsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('unverified')
  listUnverified() {
    return this.service.listUnverified();
  }

  @Post(':staffId/verify')
  async verify(
    @CurrentUser() user: AuthContext,
    @Param('staffId') staffId: string,
  ) {
    const verifierId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!verifierId) {
      throw new ForbiddenException(
        'Only staff can verify a payout bank account',
      );
    }
    return this.service.verify(staffId, verifierId, user.sub);
  }
}
