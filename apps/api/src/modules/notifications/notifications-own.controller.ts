import { Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { NotificationsService } from './notifications.service';

/** The calling identity's own in-app notification feed (dashboard widget). */
@Controller('notifications/me')
export class NotificationsOwnController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.notificationsService.listForIdentity(user.sub);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthContext) {
    await this.notificationsService.markAllRead(user.sub);
    return { ok: true };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.notificationsService.markRead(id, user.sub);
    return { ok: true };
  }
}
