import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsOwnController } from './notifications-own.controller';
import { NotificationsService } from './notifications.service';
import { MockNotificationProviderService } from './providers/mock-notification-provider.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';
import { NotificationProviderRouter } from './providers/notification-provider.router';
import { SmtpNotificationProviderService } from './providers/smtp-notification-provider.service';

@Module({
  imports: [ConfigModule, IntegrationsModule],
  controllers: [NotificationsOwnController, NotificationsController],
  providers: [
    NotificationsService,
    MockNotificationProviderService,
    SmtpNotificationProviderService,
    NotificationProviderRouter,
    { provide: NOTIFICATION_PROVIDER, useExisting: NotificationProviderRouter },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
