import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateTravelPackageDto } from './dto/create-travel-package.dto';
import { TravelPackagesService } from './travel-packages.service';

@Controller('travel-packages')
@RequirePermissions(PERMISSIONS.HOTEL.PACKAGE_MANAGE)
export class TravelPackagesController {
  constructor(
    private readonly packagesService: TravelPackagesService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateTravelPackageDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.packagesService.create(dto, staffId ?? undefined);
  }

  @Get()
  list() {
    return this.packagesService.listAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.packagesService.get(id);
  }

  @Post(':id/confirm-incentive')
  async confirmIncentive(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ) {
    return this.packagesService.confirmAndPayIncentive(id, user.sub);
  }
}
