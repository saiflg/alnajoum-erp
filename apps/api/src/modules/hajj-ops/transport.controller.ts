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

@Controller('hajj-ops/transport')
export class TransportController {
  constructor(private readonly service: TransportService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.TRANSPORT_MANAGE)
  create(@Body() dto: CreateTransportDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listAll(
    @Query('hajjGroupId') hajjGroupId?: string,
    @Query('umrahGroupId') umrahGroupId?: string,
    @Query('status') status?: TransportStatus,
  ) {
    return this.service.listAll({ hajjGroupId, umrahGroupId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.TRANSPORT_MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTransportStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
