import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import {
  NotificationProviderPort,
  SendEmailInput,
  SendEmailResult,
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
    const host = this.configService.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        'NOTIFICATION_PROVIDER=smtp but SMTP_HOST is not set; emails will fail to send until SMTP is configured.',
      );
      return;
    }

    this.fromAddress =
      this.configService.get<string>('SMTP_FROM') ?? 'no-reply@alnajoum.travel';
    this.transporter = nodemailer.createTransport({
      host,
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: this.configService.get<string>('SMTP_USER')
        ? {
            user: this.configService.get<string>('SMTP_USER'),
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
}
