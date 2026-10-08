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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
@Controller('hajj-ops/rooms')
export class RoomAllocationController {
  constructor(private readonly service: RoomAllocationService) {}

  @TenantScoped(
    { kind: 'hajjGroup', param: 'hajjGroupId', source: 'body' },
    { kind: 'umrahGroup', param: 'umrahGroupId', source: 'body' },
    { kind: 'hotelBooking', param: 'hotelBookingId', source: 'body' },
  )
  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateRoomAllocationDto,
  ) {
    return this.service.create(dto, user.companyId ?? undefined);
  }

  @TenantScoped(
    { kind: 'hajjGroup', param: 'hajjGroupId', source: 'query' },
    { kind: 'umrahGroup', param: 'umrahGroupId', source: 'query' },
  )
  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  listForGroup(
    @CurrentUser() user: AuthContext,
    @Query('hajjGroupId') hajjGroupId?: string,
    @Query('umrahGroupId') umrahGroupId?: string,
  ) {
    return this.service.listForGroup(
      { hajjGroupId, umrahGroupId },
      resolveTenantFilter(user),
    );
  }

  /** Registered before ':id' so "hotel-bookings" is never parsed as a room id. */
  @Get('hotel-bookings')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  listLinkableHotelBookings(
    @CurrentUser() user: AuthContext,
    @Query('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Query('groupId') groupId: string,
  ) {
    return this.service.listLinkableHotelBookings(
      type,
      groupId,
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('roomAllocation')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @TenantScoped('roomAllocation', {
    kind: 'hajjRegistrationPilgrim',
    param: 'pilgrimId',
    source: 'body',
  })
  @Post(':id/occupants')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  assignOccupant(@Param('id') id: string, @Body() dto: AssignOccupantDto) {
    return this.service.assignOccupant(id, dto);
  }

  @TenantScoped('roomAllocation')
  @Delete(':id/occupants/:occupantId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.GROUP_MANAGE)
  removeOccupant(
    @Param('id') id: string,
    @Param('occupantId') occupantId: string,
  ) {
    return this.service.removeOccupant(id, occupantId);
  }

  @TenantScoped('roomAllocation')
  @Post(':id/occupants/:occupantId/check-in')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  checkInOccupant(
    @Param('id') id: string,
    @Param('occupantId') occupantId: string,
  ) {
    return this.service.checkInOccupant(id, occupantId);
  }
}
