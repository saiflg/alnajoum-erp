import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RegisterHajjDto } from './dto/register-hajj.dto';
import { HajjRegistrationsService } from './hajj-registrations.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@RequireFeature('ENABLE_HAJJ')
@Controller('hajj/registrations')
export class HajjRegistrationsAdminController {
  constructor(
    private readonly registrationsService: HajjRegistrationsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.HAJJ_REGISTRATION.READ)
  list(
    @CurrentUser() user: AuthContext,
    @Query('customerId') customerId?: string,
    @Query('packageId') packageId?: string,
  ) {
    return this.registrationsService.listAll(
      { customerId, packageId },
      resolveTenantFilter(user),
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_REGISTRATION.READ)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.registrationsService.getRegistration(
      id,
      undefined,
      resolveTenantFilter(user),
    );
  }

  /** Staff registering a customer on their behalf (walk-in / phone booking). */
  @Post('for/:customerId')
  @RequirePermissions(PERMISSIONS.HAJJ_REGISTRATION.CREATE)
  async registerFor(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: RegisterHajjDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.registrationsService.register(
      customerId,
      dto.packageId,
      dto.pilgrims,
      staffId ?? undefined,
    );
  }
}
