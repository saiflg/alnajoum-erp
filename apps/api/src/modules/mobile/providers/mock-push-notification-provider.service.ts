import { Injectable, Logger } from '@nestjs/common';
import {
  PushNotificationProviderPort,
  SendPushInput,
  SendPushResult,
} from './push-notification-provider.port';

/**
 * Logs the push payload instead of delivering it. The only push provider
 * actually reachable in this phase — see PushNotificationProviderRouter —
 * since no real FCM/APNs credentials exist in this environment. Same "mock
 * first" reasoning as MockNotificationProviderService.
 */
@Injectable()
export class MockPushNotificationProviderService
  implements PushNotificationProviderPort
{
  private readonly logger = new Logger(MockPushNotificationProviderService.name);

  sendPush(input: SendPushInput): Promise<SendPushResult> {
    this.logger.log(
      `[mock push] token=${input.token} title="${input.title}"\n${input.body}${input.data ? `\ndata=${JSON.stringify(input.data)}` : ''}`,
    );
    return Promise.resolve({ success: true });
  }
}
