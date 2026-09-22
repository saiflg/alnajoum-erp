import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AiUsageService } from './ai-usage.service';

/** Phase 13 spec #40 — lets an administrator review AI usage. */
@Controller('ai/usage')
export class AiUsageAdminController {
  constructor(private readonly aiUsageService: AiUsageService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI.USAGE_VIEW)
  list(@CurrentUser() user: AuthContext) {
    return this.aiUsageService.listRecent(resolveTenantFilter(user));
  }
}
