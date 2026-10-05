import { Injectable } from '@nestjs/common';
import {
  PushNotificationProviderPort,
  SendPushInput,
  SendPushResult,
} from './push-notification-provider.port';

/**
 * Real Apple Push Notification service integration point for iOS. Same
 * stub reasoning as FcmPushNotificationProviderService — no production
 * APNs key/certificate may live in this environment.
 */
@Injectable()
export class ApnsPushNotificationProviderService
  implements PushNotificationProviderPort
{
  sendPush(_input: SendPushInput): Promise<SendPushResult> {
    return Promise.resolve({
      success: false,
      error: 'APNs is not configured for this deployment',
    });
  }
}
