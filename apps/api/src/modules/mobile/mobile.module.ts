import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MobileAppConfigController } from './mobile-app-config.controller';
import { MobileAppConfigService } from './mobile-app-config.service';
import { MobileDevicesController } from './mobile-devices.controller';
import { MobileDevicesService } from './mobile-devices.service';
import { ApnsPushNotificationProviderService } from './providers/apns-push-notification-provider.service';
import { FcmPushNotificationProviderService } from './providers/fcm-push-notification-provider.service';
import { MockPushNotificationProviderService } from './providers/mock-push-notification-provider.service';
import { PUSH_NOTIFICATION_PROVIDER } from './providers/push-notification-provider.port';
import { PushNotificationProviderRouter } from './providers/push-notification-provider.router';

@Module({
  imports: [AuditModule],
  controllers: [MobileDevicesController, MobileAppConfigController],
  providers: [
    MobileDevicesService,
    MobileAppConfigService,
    MockPushNotificationProviderService,
    FcmPushNotificationProviderService,
    ApnsPushNotificationProviderService,
    PushNotificationProviderRouter,
    {
      provide: PUSH_NOTIFICATION_PROVIDER,
      useExisting: PushNotificationProviderRouter,
    },
  ],
  exports: [MobileDevicesService, PUSH_NOTIFICATION_PROVIDER],
})
export class MobileModule {}
