import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { InvoicesService } from './invoices.service';

@Controller('invoices/me')
export class InvoicesOwnController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly customersService: CustomersService,
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
}
