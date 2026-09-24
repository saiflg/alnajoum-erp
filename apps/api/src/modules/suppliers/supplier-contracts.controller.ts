import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateSupplierContractDto } from './dto/create-supplier-contract.dto';
import { UpdateSupplierContractDto } from './dto/update-supplier-contract.dto';
import { SupplierContractsService } from './supplier-contracts.service';

@Controller()
export class SupplierContractsController {
  constructor(private readonly service: SupplierContractsService) {}

  @Get('suppliers/:supplierId/contracts')
  @RequirePermissions(PERMISSIONS.SUPPLIER.CONTRACT_VIEW)
  list(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
  ) {
    return this.service.listForSupplier(supplierId, resolveTenantFilter(user));
  }

  @Post('suppliers/:supplierId/contracts')
  @RequirePermissions(PERMISSIONS.SUPPLIER.CONTRACT_MANAGE)
  create(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierContractDto,
  ) {
    return this.service.create(
      supplierId,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  @Get('supplier-contracts/expiring-soon')
  @RequirePermissions(PERMISSIONS.SUPPLIER.CONTRACT_VIEW)
  expiringSoon(@CurrentUser() user: AuthContext) {
    return this.service.listExpiringSoon(resolveTenantFilter(user));
  }

  @Patch('supplier-contracts/:id')
  @RequirePermissions(PERMISSIONS.SUPPLIER.CONTRACT_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierContractDto,
  ) {
    return this.service.update(id, dto, resolveTenantFilter(user), user.sub);
  }
}
