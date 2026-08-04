import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Controller('invoices')
export class InvoicesAdminController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVOICE.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: InvoiceStatus,
  ) {
    return this.invoicesService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVOICE.READ)
  findOne(@Param('id') id: string) {
    return this.invoicesService.getInvoice(id);
  }

  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.PAYMENT.RECORD)
  async recordPayment(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.paymentsService.recordPayment(id, dto, staffId ?? undefined);
  }
}
