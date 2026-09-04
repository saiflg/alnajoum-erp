import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MockNotificationProviderService } from './mock-notification-provider.service';
import {
  NotificationProviderPort,
  SendEmailInput,
  SendEmailResult,
  SendTextInput,
  SendTextResult,
} from './notification-provider.port';
import { SmtpNotificationProviderService } from './smtp-notification-provider.service';

/** Same runtime-switchable pattern as FlightProviderRouter — see its doc
 * comment. Falls back to NOTIFICATION_PROVIDER when nothing has been
 * activated at /admin/integrations yet. */
@Injectable()
export class NotificationProviderRouter implements NotificationProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockNotificationProviderService,
    private readonly smtpProvider: SmtpNotificationProviderService,
  ) {}

  private async resolve(): Promise<NotificationProviderPort> {
    const active =
      await this.integrationsService.getActiveProvider('NOTIFICATION');
    const providerName =
      active ?? this.configService.get<string>('NOTIFICATION_PROVIDER', 'mock');
    return providerName === 'smtp' ? this.smtpProvider : this.mockProvider;
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    return (await this.resolve()).sendEmail(input);
  }

  async sendSms(input: SendTextInput): Promise<SendTextResult> {
    return (await this.resolve()).sendSms(input);
  }

  async sendWhatsApp(input: SendTextInput): Promise<SendTextResult> {
    return (await this.resolve()).sendWhatsApp(input);
  }
}
