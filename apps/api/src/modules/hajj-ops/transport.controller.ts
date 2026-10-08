import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TransportStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  CreateTransportDto,
  UpdateTransportStatusDto,
} from './dto/transport.dto';
import { TransportService } from './transport.service';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
@Controller('hajj-ops/transport')
export class TransportController {
  constructor(private readonly service: TransportService) {}

  @TenantScoped(
    { kind: 'hajjGroup', param: 'hajjGroupId', source: 'body' },
    { kind: 'umrahGroup', param: 'umrahGroupId', source: 'body' },
    { kind: 'vehicle', param: 'vehicleId', source: 'body' },
    { kind: 'driver', param: 'driverId', source: 'body' },
  )
  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.TRANSPORT_MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateTransportDto) {
    return this.service.create(dto, user.companyId ?? undefined);
  }

  @TenantScoped(
    { kind: 'hajjGroup', param: 'hajjGroupId', source: 'query' },
    { kind: 'umrahGroup', param: 'umrahGroupId', source: 'query' },
  )
  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listAll(
    @CurrentUser() user: AuthContext,
    @Query('hajjGroupId') hajjGroupId?: string,
    @Query('umrahGroupId') umrahGroupId?: string,
    @Query('status') status?: TransportStatus,
  ) {
    return this.service.listAll(
      { hajjGroupId, umrahGroupId, status },
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('transport')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @TenantScoped('transport')
  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.TRANSPORT_MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTransportStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
