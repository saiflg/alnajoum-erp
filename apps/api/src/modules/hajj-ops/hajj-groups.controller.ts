import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TravelGroupStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AssignPilgrimToGroupDto } from './dto/assign-pilgrim.dto';
import {
  CreateHajjGroupDto,
  UpdateGroupStatusDto,
} from './dto/create-group.dto';
import { HajjGroupsService } from './hajj-groups.service';

@Controller('hajj-ops/hajj-groups')
export class HajjGroupsController {
  constructor(private readonly service: HajjGroupsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  create(@Body() dto: CreateHajjGroupDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listAll(
    @Query('status') status?: TravelGroupStatus,
    @Query('packageId') packageId?: string,
  ) {
    return this.service.listAll({ status, packageId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateGroupStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }

  @Post(':id/pilgrims')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  assignPilgrim(@Param('id') id: string, @Body() dto: AssignPilgrimToGroupDto) {
    return this.service.assignPilgrim(id, dto.pilgrimId);
  }

  @Patch(':id/pilgrims/:pilgrimId/remove')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  removePilgrim(
    @Param('id') id: string,
    @Param('pilgrimId') pilgrimId: string,
  ) {
    return this.service.removePilgrim(id, pilgrimId);
  }
}
