import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationProviderPort,
  SendEmailInput,
  SendEmailResult,
  SendTextInput,
  SendTextResult,
} from './notification-provider.port';

/**
 * Logs the email/SMS/WhatsApp message instead of sending it. Default
 * provider in dev/test so the platform is fully exercisable without real
 * SMTP/SMS/WhatsApp credentials — same "mock first" reasoning as
 * MockFlightProviderService.
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

  sendSms(input: SendTextInput): Promise<SendTextResult> {
    this.logger.log(`[mock sms] to=${input.to}\n${input.body}`);
    return Promise.resolve({ success: true });
  }

  sendWhatsApp(input: SendTextInput): Promise<SendTextResult> {
    this.logger.log(`[mock whatsapp] to=${input.to}\n${input.body}`);
    return Promise.resolve({ success: true });
  }
}
