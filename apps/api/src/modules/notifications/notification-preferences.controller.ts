import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { NotificationPreferencesService } from './notification-preferences.service';

/** Spec #18/#19 — any authenticated identity (staff or customer) manages their own; no separate RBAC permission needed. */
@Controller('notifications/preferences/me')
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.preferencesService.get(user.sub);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthContext,
    @Body()
    body: Partial<{
      emailEnabled: boolean;
      smsEnabled: boolean;
      whatsappEnabled: boolean;
      inAppEnabled: boolean;
    }>,
  ) {
    return this.preferencesService.update(user.sub, body);
  }
}
