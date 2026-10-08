import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  Post,
} from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { OverrideReadinessDto } from './dto/override-readiness.dto';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ReadinessService } from './readiness.service';
import { UsersService } from '../users/users.service';

import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
@Controller('hajj-ops/readiness')
export class ReadinessController {
  constructor(
    private readonly service: ReadinessService,
    private readonly usersService: UsersService,
  ) {}

  /** Spec #3/#28-#29 — one pilgrim's document checklist + readiness score. */
  @TenantScoped({
    kindBy: {
      param: 'type',
      map: {
        HAJJ: 'hajjRegistrationPilgrim',
        UMRAH: 'umrahRegistrationPilgrim',
      },
    },
  })
  @Get(':type/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECKLIST_VIEW)
  get(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
  ) {
    return this.service.compute(type, id);
  }

  /** Spec #29 — readiness for every pilgrim in a group at a glance. */
  @TenantScoped({
    param: 'groupId',
    kindBy: { param: 'type', map: { HAJJ: 'hajjGroup', UMRAH: 'umrahGroup' } },
  })
  @Get('group/:type/:groupId')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECKLIST_VIEW)
  getForGroup(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('groupId') groupId: string,
  ) {
    return this.service.computeForGroup(type, groupId);
  }

  /** Spec #30 — authorized, audited manual override; never available without CHECKLIST_OVERRIDE. */
  @TenantScoped({
    kindBy: {
      param: 'type',
      map: {
        HAJJ: 'hajjRegistrationPilgrim',
        UMRAH: 'umrahRegistrationPilgrim',
      },
    },
  })
  @Post(':type/:id/override')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECKLIST_OVERRIDE)
  async override(
    @CurrentUser() user: AuthContext,
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
    @Body() dto: OverrideReadinessDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException(
        'Only staff can override a readiness status',
      );
    }
    return this.service.setOverride(type, id, dto.status, dto.reason, staffId);
  }
}
