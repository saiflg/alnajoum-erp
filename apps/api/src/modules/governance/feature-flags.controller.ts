import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { SetFeatureFlagOverrideDto } from './dto/set-feature-flag-override.dto';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FEATURE_FLAG.VIEW)
  list(@CurrentUser() user: AuthContext) {
    const tenantCompanyId = resolveTenantFilter(user);
    return this.service.listAll(
      tenantCompanyId === undefined ? undefined : tenantCompanyId,
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FEATURE_FLAG.MANAGE)
  create(@Body() dto: CreateFeatureFlagDto) {
    return this.service.create(dto);
  }

  /** Sets/clears this caller's OWN tenant's override — SUPER_ADMIN must
   * use the platform-wide default (isEnabledByDefault) instead of a
   * per-tenant override, since it has no single companyId of its own. */
  @Put(':key/override')
  @RequirePermissions(PERMISSIONS.FEATURE_FLAG.MANAGE)
  setOverride(
    @CurrentUser() user: AuthContext,
    @Param('key') key: string,
    @Body() dto: SetFeatureFlagOverrideDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to override — edit isEnabledByDefault instead.',
      );
    }
    return this.service.setOverride(key, tenantCompanyId, dto.isEnabled);
  }

  @Delete(':key/override')
  @RequirePermissions(PERMISSIONS.FEATURE_FLAG.MANAGE)
  clearOverride(@CurrentUser() user: AuthContext, @Param('key') key: string) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant override to clear.',
      );
    }
    return this.service.clearOverride(key, tenantCompanyId);
  }
}
