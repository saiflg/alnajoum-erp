import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationProviderPort,
  SendEmailInput,
  SendEmailResult,
} from './notification-provider.port';

/**
 * Logs the email instead of sending it. Default provider in dev/test so
 * the platform is fully exercisable without real SMTP credentials — same
 * "mock first" reasoning as MockFlightProviderService.
 */
@Injectable()
export class MockNotificationProviderService implements NotificationProviderPort {
  private readonly logger = new Logger(MockNotificationProviderService.name);

  sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    this.logger.log(
      `[mock email] to=${input.to} subject="${input.subject}"\n${input.textBody}`,
    );
    return Promise.resolve({ success: true });
  }
}
