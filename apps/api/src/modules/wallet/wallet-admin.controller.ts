import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreditWalletDto } from './dto/credit-wallet.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletAdminController {
  constructor(
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WALLET.READ_ALL)
  listAll() {
    return this.walletService.listAllWallets();
  }

  @Get(':customerId')
  @RequirePermissions(PERMISSIONS.WALLET.READ_ALL)
  getOne(@Param('customerId') customerId: string) {
    return this.walletService.getWalletWithBalance(customerId);
  }

  @Post(':customerId/credit')
  @RequirePermissions(PERMISSIONS.WALLET.CREDIT)
  async credit(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: CreditWalletDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.walletService.creditManual(
      customerId,
      dto.amount,
      dto.description,
      staffId ?? undefined,
      user.sub,
    );
  }

  @Post(':customerId/adjust')
  @RequirePermissions(PERMISSIONS.WALLET.ADJUST)
  async adjust(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: AdjustWalletDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.walletService.adjust(
      customerId,
      dto.amount,
      dto.type,
      dto.description,
      staffId ?? undefined,
      user.sub,
    );
  }
}
