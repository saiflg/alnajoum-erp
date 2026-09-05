import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  AssignOccupantDto,
  CreateRoomAllocationDto,
} from './dto/room-allocation.dto';
import { RoomAllocationService } from './room-allocation.service';

@Controller('hajj-ops/rooms')
export class RoomAllocationController {
  constructor(private readonly service: RoomAllocationService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  create(@Body() dto: CreateRoomAllocationDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listForGroup(
    @Query('hajjGroupId') hajjGroupId?: string,
    @Query('umrahGroupId') umrahGroupId?: string,
  ) {
    return this.service.listForGroup({ hajjGroupId, umrahGroupId });
  }

  /** Registered before ':id' so "hotel-bookings" is never parsed as a room id. */
  @Get('hotel-bookings')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  listLinkableHotelBookings(
    @Query('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Query('groupId') groupId: string,
  ) {
    return this.service.listLinkableHotelBookings(type, groupId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/occupants')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  assignOccupant(@Param('id') id: string, @Body() dto: AssignOccupantDto) {
    return this.service.assignOccupant(id, dto);
  }

  @Delete(':id/occupants/:occupantId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  removeOccupant(
    @Param('id') id: string,
    @Param('occupantId') occupantId: string,
  ) {
    return this.service.removeOccupant(id, occupantId);
  }

  @Post(':id/occupants/:occupantId/check-in')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  checkInOccupant(
    @Param('id') id: string,
    @Param('occupantId') occupantId: string,
  ) {
    return this.service.checkInOccupant(id, occupantId);
  }
}
