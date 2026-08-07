import { Controller, Get, Query } from '@nestjs/common';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATION.READ)
  list(
    @Query('type') type?: NotificationType,
    @Query('status') status?: NotificationStatus,
  ) {
    return this.notificationsService.listAll({ type, status });
  }
}
