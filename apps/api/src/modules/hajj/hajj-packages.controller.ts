import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PackageStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateHajjPackageDto } from './dto/create-hajj-package.dto';
import { UpdateHajjPackageDto } from './dto/update-hajj-package.dto';
import { HajjPackagesService } from './hajj-packages.service';

@Controller('hajj/packages')
export class HajjPackagesController {
  constructor(private readonly packagesService: HajjPackagesService) {}

  /** Public catalogue — published packages only, no internal cost. */
  @Public()
  @Get()
  findPublished() {
    return this.packagesService.findAllPublished();
  }

  @Get('admin')
  @RequirePermissions(PERMISSIONS.HAJJ_PACKAGE.READ)
  findAllAdmin(@Query('status') status?: PackageStatus) {
    return this.packagesService.findAllAdmin(status);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id, true);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.HAJJ_PACKAGE.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateHajjPackageDto) {
    return this.packagesService.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_PACKAGE.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateHajjPackageDto,
  ) {
    return this.packagesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.HAJJ_PACKAGE.DELETE)
  async remove(@Param('id') id: string) {
    await this.packagesService.remove(id);
    return { deleted: true };
  }
}
