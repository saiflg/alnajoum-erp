import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SupplierPayableStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RecordSupplierPaymentDto } from './dto/record-supplier-payment.dto';
import { SupplierPayablesService } from './supplier-payables.service';

@Controller('finance/supplier-payables')
@RequirePermissions(PERMISSIONS.FINANCE.SUPPLIER_PAYABLES_MANAGE)
export class SupplierPayablesController {
  constructor(
    private readonly service: SupplierPayablesService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async listAll(
    @Query('status') status?: SupplierPayableStatus,
    @Query('supplierName') supplierName?: string,
  ) {
    await this.service.markOverdue();
    return this.service.listAll({ status, supplierName });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/payments')
  async recordPayment(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecordSupplierPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can record a supplier payment');
    }
    return this.service.recordPayment(id, dto, staffId, user.sub);
  }
}
