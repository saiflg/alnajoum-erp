import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
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
 * Set NOTIFICATION_PROVIDER=smtp plus SMTP_HOST/PORT/USER/PASSWORD/FROM to
 * use it; any real or sandbox SMTP server (a self-hosted server, Mailtrap,
 * Amazon SES's SMTP interface, etc.) works without code changes.
 */
@Injectable()
export class SmtpNotificationProviderService
  implements NotificationProviderPort, OnModuleInit
{
  private readonly logger = new Logger(SmtpNotificationProviderService.name);
  private transporter: Transporter | null = null;
  private fromAddress = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // NestJS instantiates every registered provider regardless of which one
    // NOTIFICATION_PROVIDER actually selects for use — without this check,
    // this warning fires even when "mock" is the active provider and SMTP
    // was never meant to be configured.
    const isActiveProvider =
      this.configService.get<string>('NOTIFICATION_PROVIDER') === 'smtp';

    const host = this.configService.get<string>('SMTP_HOST');
    if (!host) {
      if (isActiveProvider) {
        this.logger.warn(
          'NOTIFICATION_PROVIDER=smtp but SMTP_HOST is not set; emails will fail to send until SMTP is configured.',
        );
      }
      return;
    }

    const user = this.configService.get<string>('SMTP_USER');
    // Falling back to the authenticated SMTP account itself (rather than a
    // made-up domain) matches how most providers actually behave — Gmail in
    // particular rejects or silently rewrites a From address that doesn't
    // match the authenticated account unless "Send As" is explicitly set up.
    this.fromAddress =
      this.configService.get<string>('SMTP_FROM') ?? user ?? '';
    this.transporter = nodemailer.createTransport({
      host,
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: user
        ? {
            user,
            pass: this.configService.get<string>('SMTP_PASSWORD'),
          }
        : undefined,
    });
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.transporter) {
      return {
        success: false,
        error: 'SMTP is not configured (SMTP_HOST missing)',
      };
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
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
  // sendEmail() above does when SMTP_HOST is missing.
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
