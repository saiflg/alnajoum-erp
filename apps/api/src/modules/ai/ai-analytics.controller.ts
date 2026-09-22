import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AiAnalyticsService } from './ai-analytics.service';
import { AskAnalyticsDto } from './dto/ask-analytics.dto';

/** Phase 13 spec #7/#8/#31 — natural-language business analytics. See
 * AiAnalyticsService's own doc comment for the safety model (allowlisted
 * queries only, every number from a real tenant-scoped Prisma query). */
@Controller('ai/analytics')
export class AiAnalyticsController {
  constructor(private readonly aiAnalyticsService: AiAnalyticsService) {}

  @Post('ask')
  @RequirePermissions(PERMISSIONS.AI.ANALYTICS_QUERY)
  ask(@CurrentUser() user: AuthContext, @Body() dto: AskAnalyticsDto) {
    return this.aiAnalyticsService.ask(dto.question, user);
  }
}
