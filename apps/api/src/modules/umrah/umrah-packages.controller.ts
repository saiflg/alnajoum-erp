import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PackageStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateUmrahPackageDto } from './dto/create-umrah-package.dto';
import { UpdateUmrahPackageDto } from './dto/update-umrah-package.dto';
import { UmrahPackagesService } from './umrah-packages.service';

@Controller('umrah/packages')
export class UmrahPackagesController {
  constructor(private readonly packagesService: UmrahPackagesService) {}

  /** Public catalogue — published packages only, no cost/incentive data. */
  @Public()
  @Get()
  findPublished() {
    return this.packagesService.findAllPublished();
  }

  @Get('admin')
  @RequirePermissions(PERMISSIONS.UMRAH_PACKAGE.READ)
  findAllAdmin(@Query('status') status?: PackageStatus) {
    return this.packagesService.findAllAdmin(status);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id, true);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.UMRAH_PACKAGE.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateUmrahPackageDto) {
    return this.packagesService.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UMRAH_PACKAGE.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateUmrahPackageDto,
  ) {
    return this.packagesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.UMRAH_PACKAGE.DELETE)
  async remove(@Param('id') id: string) {
    await this.packagesService.remove(id);
    return { deleted: true };
  }
}
