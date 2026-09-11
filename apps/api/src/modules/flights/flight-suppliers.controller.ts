import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFlightSupplierDto } from './dto/create-flight-supplier.dto';
import { UpdateFlightSupplierDto } from './dto/update-flight-supplier.dto';
import { FlightSuppliersService } from './flight-suppliers.service';

@Controller('flight-suppliers')
@RequirePermissions(PERMISSIONS.FLIGHT.SUPPLIER_MANAGE)
export class FlightSuppliersController {
  constructor(private readonly service: FlightSuppliersService) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Query('status') status?: string) {
    return this.service.listAll({ status }, resolveTenantFilter(user));
  }

  /** A supplier's negotiated terms belong to exactly one tenant — a Super
   * Admin has no single tenant to attribute a new one to. */
  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateFlightSupplierDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to create a supplier for — sign in as a tenant admin instead.',
      );
    }
    return this.service.create(dto, tenantCompanyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.get(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateFlightSupplierDto,
  ) {
    return this.service.update(id, dto, resolveTenantFilter(user));
  }

  @Get(':id/balance')
  getBalance(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.getBalance(id, resolveTenantFilter(user));
  }
}
