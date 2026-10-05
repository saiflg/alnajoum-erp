import { Injectable } from '@nestjs/common';
import { ApnsPushNotificationProviderService } from './apns-push-notification-provider.service';
import { FcmPushNotificationProviderService } from './fcm-push-notification-provider.service';
import { MockPushNotificationProviderService } from './mock-push-notification-provider.service';
import {
  PushNotificationProviderPort,
  SendPushInput,
  SendPushResult,
} from './push-notification-provider.port';

/**
 * Routes per-call by the target device's own `pushProvider` column (set
 * when the device registered its token — 'EXPO' for an Expo-managed app,
 * 'FCM'/'APNS' for a bare React Native build) rather than one
 * deployment-wide active provider, since a single customer's devices can
 * legitimately be a mix of platforms. Expo's push service itself speaks
 * FCM/APNs under the hood, so an 'EXPO' token is routed through the mock
 * provider in this phase for the same "no real provider credentials here"
 * reason as FCM/APNs — see those services' own doc comments.
 */
@Injectable()
export class PushNotificationProviderRouter
  implements PushNotificationProviderPort
{
  constructor(
    private readonly mockProvider: MockPushNotificationProviderService,
    private readonly fcmProvider: FcmPushNotificationProviderService,
    private readonly apnsProvider: ApnsPushNotificationProviderService,
  ) {}

  private resolve(pushProvider: string | null | undefined): PushNotificationProviderPort {
    switch (pushProvider) {
      case 'FCM':
        return this.fcmProvider;
      case 'APNS':
        return this.apnsProvider;
      default:
        return this.mockProvider;
    }
  }

  async sendPush(
    input: SendPushInput & { provider?: string | null },
  ): Promise<SendPushResult> {
    return this.resolve(input.provider).sendPush(input);
  }
}
