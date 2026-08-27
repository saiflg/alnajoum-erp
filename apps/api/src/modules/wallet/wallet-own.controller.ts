import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { DepositWalletDto } from './dto/deposit-wallet.dto';
import { PayInvoiceWithWalletDto } from './dto/pay-invoice-with-wallet.dto';
import { VerifyWalletCheckoutDto } from './dto/verify-wallet-checkout.dto';
import { WalletService } from './wallet.service';

@Controller('wallet/me')
export class WalletOwnController {
  constructor(
    private readonly walletService: WalletService,
    private readonly customersService: CustomersService,
  ) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.walletService.getWalletWithBalance(customerId);
  }

  @Post('deposit')
  async deposit(
    @CurrentUser() user: AuthContext,
    @Body() dto: DepositWalletDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.walletService.initiateDeposit(customerId, dto.amount);
  }

  @Post('deposit/verify')
  async verifyDeposit(
    @CurrentUser() user: AuthContext,
    @Body() dto: VerifyWalletCheckoutDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.walletService.verifyDeposit(customerId, dto.reference);
  }

  @Post('pay-invoice')
  async payInvoice(
    @CurrentUser() user: AuthContext,
    @Body() dto: PayInvoiceWithWalletDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.walletService.payInvoiceWithWallet(
      customerId,
      dto.invoiceId,
      dto.amount,
    );
  }
}
