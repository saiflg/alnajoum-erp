import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { SetSystemSettingDto } from './dto/set-system-setting.dto';
import { SystemSettingsService } from './system-settings.service';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly service: SystemSettingsService) {}

  @Get(':category')
  @RequirePermissions(PERMISSIONS.SETTINGS.VIEW)
  listForCategory(
    @CurrentUser() user: AuthContext,
    @Param('category') category: string,
  ) {
    return this.service.listForCategory(category, resolveTenantFilter(user));
  }

  @Put(':category/:key')
  @RequirePermissions(PERMISSIONS.SETTINGS.EDIT)
  set(
    @CurrentUser() user: AuthContext,
    @Param('category') category: string,
    @Param('key') key: string,
    @Body() dto: SetSystemSettingDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    return this.service.set(
      category,
      key,
      dto.value as Prisma.InputJsonValue,
      user.sub,
      tenantCompanyId === undefined ? undefined : tenantCompanyId,
      dto.reason,
    );
  }

  @Get('history/:settingId')
  @RequirePermissions(PERMISSIONS.SETTINGS.VIEW)
  history(@Param('settingId') settingId: string) {
    return this.service.history(settingId);
  }
}
