import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { RegisterUmrahDto } from './dto/register-umrah.dto';
import { UmrahRegistrationsService } from './umrah-registrations.service';

@Controller('umrah/registrations')
export class UmrahRegistrationsAdminController {
  constructor(
    private readonly registrationsService: UmrahRegistrationsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.UMRAH_REGISTRATION.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('packageId') packageId?: string,
  ) {
    return this.registrationsService.listAll({ customerId, packageId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.UMRAH_REGISTRATION.READ)
  findOne(@Param('id') id: string) {
    return this.registrationsService.getRegistration(id);
  }

  /** Staff registering a customer on their behalf (walk-in / phone booking). */
  @Post('for/:customerId')
  @RequirePermissions(PERMISSIONS.UMRAH_REGISTRATION.CREATE)
  async registerFor(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: RegisterUmrahDto,
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
