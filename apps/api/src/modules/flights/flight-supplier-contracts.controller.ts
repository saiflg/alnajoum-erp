import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFlightSupplierContractDto } from './dto/create-flight-supplier-contract.dto';
import { UpdateFlightSupplierContractDto } from './dto/update-flight-supplier-contract.dto';
import { FlightSupplierContractsService } from './flight-supplier-contracts.service';

@RequirePermissions(PERMISSIONS.FLIGHT.SUPPLIER_MANAGE)
@Controller()
export class FlightSupplierContractsController {
  constructor(private readonly service: FlightSupplierContractsService) {}

  @Get('flight-suppliers/:supplierId/contracts')
  list(@Param('supplierId') supplierId: string) {
    return this.service.listForSupplier(supplierId);
  }

  @Post('flight-suppliers/:supplierId/contracts')
  create(
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateFlightSupplierContractDto,
  ) {
    return this.service.create(supplierId, dto);
  }

  @Patch('flight-supplier-contracts/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlightSupplierContractDto,
  ) {
    return this.service.update(id, dto);
  }

  @Get('flight-supplier-contracts/expiring-soon')
  expiringSoon() {
    return this.service.listExpiringSoon();
  }
}
