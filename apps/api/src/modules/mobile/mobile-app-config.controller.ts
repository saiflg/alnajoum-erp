import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { MobilePlatform } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UpsertMobileAppConfigDto } from './dto/upsert-mobile-app-config.dto';
import { MobileAppConfigService } from './mobile-app-config.service';

@Controller('mobile/app-config')
export class MobileAppConfigController {
  constructor(private readonly configService: MobileAppConfigService) {}

  /** Public — the app must be able to check whether it's forced to update
   * or the backend is in maintenance mode before the customer has logged
   * in at all (e.g. right after a fresh install). */
  @Public()
  @Get()
  get(@Query('platform') platform: MobilePlatform) {
    return this.configService.get(platform);
  }

  @Get('admin')
  @RequirePermissions(PERMISSIONS.MOBILE.APP_CONFIG_VIEW)
  listAll() {
    return this.configService.listAll();
  }

  @Put('admin/:platform')
  @RequirePermissions(PERMISSIONS.MOBILE.APP_CONFIG_MANAGE)
  upsert(
    @CurrentUser() user: AuthContext,
    @Param('platform') platform: MobilePlatform,
    @Body() dto: UpsertMobileAppConfigDto,
  ) {
    return this.configService.upsert(platform, dto, user.sub);
  }
}
