import { Injectable } from '@nestjs/common';
import {
  PushNotificationProviderPort,
  SendPushInput,
  SendPushResult,
} from './push-notification-provider.port';

/**
 * Real Firebase Cloud Messaging integration point for Android (and legacy
 * iOS) push. Deliberately a stub: this environment must never hold a real
 * FCM service-account credential (see PushNotificationProviderRouter and
 * this repo's "no production credentials on localhost" rule). Standing
 * ready as a real `PushNotificationProviderPort` implementation — wiring
 * in a service account later is a DI-binding change, not a call-site
 * change, same as every other provider in this codebase.
 */
@Injectable()
export class FcmPushNotificationProviderService
  implements PushNotificationProviderPort
{
  sendPush(_input: SendPushInput): Promise<SendPushResult> {
    return Promise.resolve({
      success: false,
      error: 'FCM is not configured for this deployment',
    });
  }
}
