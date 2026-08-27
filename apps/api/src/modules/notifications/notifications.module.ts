import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsOwnController } from './notifications-own.controller';
import { NotificationsService } from './notifications.service';
import { MockNotificationProviderService } from './providers/mock-notification-provider.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';
import { SmtpNotificationProviderService } from './providers/smtp-notification-provider.service';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsOwnController, NotificationsController],
  providers: [
    NotificationsService,
    MockNotificationProviderService,
    SmtpNotificationProviderService,
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [
        ConfigService,
        MockNotificationProviderService,
        SmtpNotificationProviderService,
      ],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockNotificationProviderService,
        smtpProvider: SmtpNotificationProviderService,
      ) =>
        configService.get<string>('NOTIFICATION_PROVIDER', 'mock') === 'smtp'
          ? smtpProvider
          : mockProvider,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
