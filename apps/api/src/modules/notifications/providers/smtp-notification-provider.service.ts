import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  NotificationProviderPort,
  SendEmailInput,
  SendEmailResult,
  SendTextInput,
  SendTextResult,
} from './notification-provider.port';

/**
 * Real SMTP-based sender via nodemailer. Unlike DuffelFlightProviderService,
 * this is a genuine working implementation rather than a stub — SMTP is an
 * open protocol, not a vendor SDK requiring an account to be created on the
 * agency's behalf, so there's nothing blocking implementing it for real.
 * Configure it via /admin/integrations, or set NOTIFICATION_PROVIDER=smtp
 * plus SMTP_HOST/PORT/USER/PASSWORD/FROM; any real or sandbox SMTP server
 * (self-hosted, Mailtrap, Amazon SES's SMTP interface, etc.) works without
 * code changes.
 *
 * The transporter is built fresh on every send (nodemailer's
 * createTransport is cheap — it doesn't open a connection until sendMail is
 * called) rather than once at boot, so a credential saved through the
 * settings page takes effect on the very next email without a restart.
 */
@Injectable()
export class SmtpNotificationProviderService implements NotificationProviderPort {
  private readonly logger = new Logger(SmtpNotificationProviderService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private async getSettings(): Promise<{
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    from?: string;
  }> {
    const db = await this.integrationsService.getCredentialConfig(
      'NOTIFICATION',
      'smtp',
    );
    return {
      host: db?.host || this.configService.get<string>('SMTP_HOST'),
      port: Number(db?.port || this.configService.get<number>('SMTP_PORT', 587)),
      secure:
        (db?.secure ?? this.configService.get<string>('SMTP_SECURE')) === 'true',
      user: db?.user || this.configService.get<string>('SMTP_USER'),
      password: db?.password || this.configService.get<string>('SMTP_PASSWORD'),
      from: db?.from || this.configService.get<string>('SMTP_FROM'),
    };
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const settings = await this.getSettings();
    if (!settings.host) {
      return {
        success: false,
        error: 'SMTP is not configured — add a host at /admin/integrations, or set SMTP_HOST',
      };
    }

    // Falling back to the authenticated SMTP account itself (rather than a
    // made-up domain) matches how most providers actually behave — Gmail in
    // particular rejects or silently rewrites a From address that doesn't
    // match the authenticated account unless "Send As" is explicitly set up.
    const fromAddress = settings.from ?? settings.user ?? '';
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    });

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: input.to,
        subject: input.subject,
        text: input.textBody,
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send email to ${input.to}: ${message}`);
      return { success: false, error: message };
    }
  }

  // This provider only ever configures a real SMTP transport — SMS/WhatsApp
  // need their own vendor account (Twilio, Meta's WhatsApp Business API,
  // etc.) that this project doesn't have credentials for. Honestly reports
  // "not configured" rather than silently pretending to send, exactly like
  // sendEmail() above does when no host is configured.
  sendSms(_input: SendTextInput): Promise<SendTextResult> {
    return Promise.resolve({
      success: false,
      error: 'SMS is not configured for this deployment',
    });
  }

  sendWhatsApp(_input: SendTextInput): Promise<SendTextResult> {
    return Promise.resolve({
      success: false,
      error: 'WhatsApp is not configured for this deployment',
    });
  }
}
