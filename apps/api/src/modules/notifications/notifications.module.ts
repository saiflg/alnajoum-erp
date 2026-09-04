import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsOwnController } from './notifications-own.controller';
import { NotificationsService } from './notifications.service';
import { MockNotificationProviderService } from './providers/mock-notification-provider.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';
import { NotificationProviderRouter } from './providers/notification-provider.router';
import { SmtpNotificationProviderService } from './providers/smtp-notification-provider.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [ConfigModule, IntegrationsModule],
  controllers: [
    NotificationsOwnController,
    NotificationsController,
    NotificationPreferencesController,
    TemplatesController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    TemplatesService,
    MockNotificationProviderService,
    SmtpNotificationProviderService,
    NotificationProviderRouter,
    { provide: NOTIFICATION_PROVIDER, useExisting: NotificationProviderRouter },
  ],
  exports: [
    NotificationsService,
    NotificationPreferencesService,
    TemplatesService,
  ],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly templatesService: TemplatesService) {}

  async onModuleInit() {
    await this.templatesService.ensureDefaults();
  }
}
