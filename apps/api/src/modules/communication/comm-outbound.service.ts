import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProviderPort,
} from '../notifications/providers/notification-provider.port';
import type {
  ProviderHealth,
  ProviderTemplate,
} from '../whatsapp/providers/whatsapp-provider.port';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';

export interface OutboundResult {
  ok: boolean;
  providerMessageId?: string;
  /** Nothing really left the machine (the built-in mock provider carried it). */
  simulated: boolean;
  error?: string;
  /** A later attempt may succeed (timeouts, rate limits, 5xx). False for a rejection that will not change. */
  retryable: boolean;
  /**
   * The call did not return in time, so the message may or may not have been sent. It must NOT be retried
   * automatically: a retry could deliver the same marketing message twice.
   */
  uncertain?: boolean;
}

export interface ChannelHealth {
  channel: 'EMAIL' | 'WHATSAPP';
  provider: string;
  /** SIMULATOR: nothing is delivered. LIVE: a real provider is selected. */
  mode: 'SIMULATOR' | 'LIVE';
  /** Whether the credentials needed for LIVE are present. */
  credentialsPresent: boolean;
  ok: boolean;
  detail: string;
}

const SEND_TIMEOUT_MS = 20_000;
const TRANSIENT =
  /timeout|timed out|econn|enotfound|network|rate|429|5\d\d|temporar|unavailable|socket/i;

class SendTimeout extends Error {}

/** Rejects if the promise has not settled in time; the underlying call may still complete. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SendTimeout('timed out')), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/**
 * The one door every Communication Centre message leaves through. It adds no policy (consent, suppression and limits
 * are decided before a message reaches it) but it does give every send the same honest shape: was it simulated,
 * can it be retried, is the outcome unknown.
 */
@Injectable()
export class CommOutboundService {
  private readonly logger = new Logger(CommOutboundService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER)
    private readonly email: NotificationProviderPort,
    private readonly whatsapp: WhatsAppProviderRouter,
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
  ) {}

  private classify(e: unknown): OutboundResult {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof SendTimeout)
      return {
        ok: false,
        simulated: false,
        retryable: false,
        uncertain: true,
        error:
          'The provider did not answer in time; the message may or may not have been sent.',
      };
    return {
      ok: false,
      simulated: false,
      retryable: TRANSIENT.test(message),
      error: message,
    };
  }

  async sendEmail(p: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
    fromName?: string;
    headers?: Record<string, string>;
  }): Promise<OutboundResult> {
    try {
      const r = await withTimeout(
        this.email.sendEmail({
          to: p.to,
          subject: p.subject,
          textBody: p.text,
          html: p.html,
          replyTo: p.replyTo,
          fromName: p.fromName,
          headers: p.headers,
        }),
        SEND_TIMEOUT_MS,
      );
      if (r.success)
        return {
          ok: true,
          simulated: r.simulated === true,
          providerMessageId: r.providerMessageId,
          retryable: false,
        };
      return {
        ok: false,
        simulated: r.simulated === true,
        error: r.error ?? 'The email provider refused the message.',
        retryable: TRANSIENT.test(r.error ?? ''),
      };
    } catch (e) {
      return this.classify(e);
    }
  }

  async sendWhatsAppTemplate(p: {
    to: string;
    templateName: string;
    language: string;
    variables: string[];
  }): Promise<OutboundResult> {
    try {
      const simulated = (await this.whatsapp.activeProviderName()) === 'mock';
      const r = await withTimeout(
        this.whatsapp.sendTemplateMessage({
          to: p.to,
          templateName: p.templateName,
          languageCode: p.language,
          variables: p.variables,
        }),
        SEND_TIMEOUT_MS,
      );
      if (r.success)
        return {
          ok: true,
          simulated,
          providerMessageId: r.providerMessageId,
          retryable: false,
        };
      return {
        ok: false,
        simulated,
        error: r.error ?? 'WhatsApp refused the message.',
        retryable: TRANSIENT.test(r.error ?? ''),
      };
    } catch (e) {
      return this.classify(e);
    }
  }

  async sendWhatsAppText(to: string, body: string): Promise<OutboundResult> {
    try {
      const simulated = (await this.whatsapp.activeProviderName()) === 'mock';
      const r = await withTimeout(
        this.whatsapp.sendTextMessage({ to, body }),
        SEND_TIMEOUT_MS,
      );
      return r.success
        ? {
            ok: true,
            simulated,
            providerMessageId: r.providerMessageId,
            retryable: false,
          }
        : {
            ok: false,
            simulated,
            error: r.error,
            retryable: TRANSIENT.test(r.error ?? ''),
          };
    } catch (e) {
      return this.classify(e);
    }
  }

  listWhatsAppTemplates(): Promise<ProviderTemplate[]> {
    return this.whatsapp.listTemplates();
  }

  // ---------------------------------------------------------------------------------------------- health

  async emailHealth(): Promise<ChannelHealth> {
    const active =
      (await this.integrations.getActiveProvider('NOTIFICATION')) ??
      this.config.get<string>('NOTIFICATION_PROVIDER', 'mock');
    if (active !== 'smtp')
      return {
        channel: 'EMAIL',
        provider: 'mock',
        mode: 'SIMULATOR',
        credentialsPresent: false,
        ok: true,
        detail:
          'Built-in simulator: emails are written to the server log, never delivered.',
      };
    const db = await this.integrations.getCredentialConfig(
      'NOTIFICATION',
      'smtp',
    );
    const host = db?.host || this.config.get<string>('SMTP_HOST');
    return {
      channel: 'EMAIL',
      provider: 'smtp',
      mode: 'LIVE',
      credentialsPresent: !!host,
      ok: !!host,
      detail: host
        ? `SMTP host ${host} is configured. A real test email has not been verified from here; use the test-send button.`
        : 'SMTP is selected but no host is configured.',
    };
  }

  async whatsappHealth(): Promise<ChannelHealth> {
    const provider = await this.whatsapp.activeProviderName();
    if (provider === 'mock')
      return {
        channel: 'WHATSAPP',
        provider: 'mock',
        mode: 'SIMULATOR',
        credentialsPresent: false,
        ok: true,
        detail:
          'Built-in simulator: messages are logged, never delivered. No WhatsApp credentials are used.',
      };
    const db = await this.integrations.getCredentialConfig('WHATSAPP', 'meta');
    const present =
      !!(db?.accessToken || this.config.get('WHATSAPP_ACCESS_TOKEN')) &&
      !!(db?.phoneNumberId || this.config.get('WHATSAPP_PHONE_NUMBER_ID'));
    if (!present)
      return {
        channel: 'WHATSAPP',
        provider: 'meta',
        mode: 'LIVE',
        credentialsPresent: false,
        ok: false,
        detail:
          'Meta is selected but the access token or phone number id is missing.',
      };
    let h: ProviderHealth;
    try {
      h = await this.whatsapp.checkHealth();
    } catch (e) {
      this.logger.warn(`WhatsApp health check failed: ${(e as Error).message}`);
      h = { live: true, ok: false, detail: (e as Error).message };
    }
    return {
      channel: 'WHATSAPP',
      provider: 'meta',
      mode: 'LIVE',
      credentialsPresent: true,
      ok: h.ok,
      detail: h.detail,
    };
  }
}
