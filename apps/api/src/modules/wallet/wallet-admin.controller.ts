import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreditWalletDto } from './dto/credit-wallet.dto';
import { TransferWalletDto } from './dto/transfer-wallet.dto';
import { WalletService } from './wallet.service';

import { RequireStepUp } from '../../common/security/step-up';
@Controller('wallet')
export class WalletAdminController {
  constructor(
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WALLET.READ_ALL)
  listAll(@CurrentUser() user: AuthContext) {
    return this.walletService.listAllWallets(resolveTenantFilter(user));
  }

  /** Static route — must be registered before the dynamic ":customerId" GET below. */
  @RequireStepUp()
  @Post('transfer')
  @RequirePermissions(PERMISSIONS.WALLET.TRANSFER)
  async transfer(
    @CurrentUser() user: AuthContext,
    @Body() dto: TransferWalletDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.walletService.transferBetweenWallets(
      dto.fromCustomerId,
      dto.toCustomerId,
      dto.amount,
      dto.description,
      staffId ?? undefined,
      user.sub,
      resolveTenantFilter(user),
      dto.idempotencyKey,
    );
  }

  @Get(':customerId')
  @RequirePermissions(PERMISSIONS.WALLET.READ_ALL)
  getOne(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
  ) {
    return this.walletService.getWalletForAdmin(
      customerId,
      resolveTenantFilter(user),
    );
  }

  @RequireStepUp()
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
      resolveTenantFilter(user),
      dto.idempotencyKey,
    );
  }

  @RequireStepUp()
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
      resolveTenantFilter(user),
      dto.idempotencyKey,
    );
  }
}
