import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { VerifyCheckoutDto } from './dto/verify-checkout.dto';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from './receipts.service';

@Controller('invoices/me')
export class InvoicesOwnController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly customersService: CustomersService,
    private readonly paymentsService: PaymentsService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.invoicesService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.invoicesService.getInvoice(id, customerId);
  }

  /** Starts an online checkout for the invoice's outstanding balance and
   * returns a URL to redirect the customer's browser to. */
  @Post(':id/checkout')
  async checkout(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.paymentsService.initiateCheckout(customerId, id);
  }

  /** Called once the browser returns from the provider's hosted checkout
   * page, to confirm the outcome and record the payment. Idempotent — safe
   * to call again (e.g. on a page refresh) once already confirmed. */
  @Post(':id/checkout/verify')
  async verifyCheckout(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VerifyCheckoutDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.paymentsService.verifyCheckout(customerId, id, dto.reference);
  }

  /** Streams a PDF receipt for one of the customer's own payments. */
  @Get('payments/:paymentId/receipt.pdf')
  async downloadReceipt(
    @CurrentUser() user: AuthContext,
    @Param('paymentId') paymentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const { stream, filename } = await this.receiptsService.renderPaymentReceipt(
      paymentId,
      customerId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }
}
