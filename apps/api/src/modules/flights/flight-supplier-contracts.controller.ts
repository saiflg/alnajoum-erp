import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFlightSupplierContractDto } from './dto/create-flight-supplier-contract.dto';
import { UpdateFlightSupplierContractDto } from './dto/update-flight-supplier-contract.dto';
import { FlightSupplierContractsService } from './flight-supplier-contracts.service';

@RequirePermissions(PERMISSIONS.FLIGHT.SUPPLIER_MANAGE)
@Controller()
export class FlightSupplierContractsController {
  constructor(private readonly service: FlightSupplierContractsService) {}

  @Get('flight-suppliers/:supplierId/contracts')
  list(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
  ) {
    return this.service.listForSupplier(supplierId, resolveTenantFilter(user));
  }

  @Post('flight-suppliers/:supplierId/contracts')
  create(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateFlightSupplierContractDto,
  ) {
    return this.service.create(supplierId, dto, resolveTenantFilter(user));
  }

  @Patch('flight-supplier-contracts/:id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateFlightSupplierContractDto,
  ) {
    return this.service.update(id, dto, resolveTenantFilter(user));
  }

  @Get('flight-supplier-contracts/expiring-soon')
  expiringSoon(@CurrentUser() user: AuthContext) {
    return this.service.listExpiringSoon(resolveTenantFilter(user));
  }
}
