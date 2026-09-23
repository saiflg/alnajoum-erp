import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  NormalizedInboundEvent,
  SendInteractiveButtonsInput,
  SendInteractiveListInput,
  SendMediaMessageInput,
  SendMessageResult,
  SendTemplateMessageInput,
  SendTextMessageInput,
  WhatsAppProviderPort,
} from './whatsapp-provider.port';
import { MetaWhatsAppProviderService } from './meta-whatsapp-provider.service';
import { MockWhatsAppProviderService } from './mock-whatsapp-provider.service';

/**
 * Resolves which concrete WhatsAppProviderPort implementation handles
 * each call, checked fresh every time — same pattern as
 * FlightProviderRouter/AiProviderRouter, so activating a real provider at
 * /admin/integrations takes effect on the next request. Falls back to the
 * WHATSAPP_PROVIDER env var, then to "mock" (spec #70's "local mode must
 * never accidentally call production WhatsApp APIs").
 *
 * All inbound webhook traffic is provider-specific by construction (Meta
 * posts to one URL, a future Twilio integration would post to another),
 * so WhatsAppWebhookController resolves its provider directly rather than
 * through this router — this router is for OUTBOUND sends, where the
 * caller genuinely doesn't need to know which provider is active.
 */
@Injectable()
export class WhatsAppProviderRouter implements WhatsAppProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockWhatsAppProviderService,
    private readonly metaProvider: MetaWhatsAppProviderService,
  ) {}

  async resolve(): Promise<WhatsAppProviderPort> {
    const active = await this.integrationsService.getActiveProvider('WHATSAPP');
    const providerName =
      active ?? this.configService.get<string>('WHATSAPP_PROVIDER', 'mock');
    return providerName === 'meta' ? this.metaProvider : this.mockProvider;
  }

  async activeProviderName(): Promise<'mock' | 'meta'> {
    const active = await this.integrationsService.getActiveProvider('WHATSAPP');
    const providerName =
      active ?? this.configService.get<string>('WHATSAPP_PROVIDER', 'mock');
    return providerName === 'meta' ? 'meta' : 'mock';
  }

  async sendTextMessage(
    input: SendTextMessageInput,
  ): Promise<SendMessageResult> {
    return (await this.resolve()).sendTextMessage(input);
  }

  async sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult> {
    return (await this.resolve()).sendTemplateMessage(input);
  }

  async sendMediaMessage(
    input: SendMediaMessageInput,
  ): Promise<SendMessageResult> {
    return (await this.resolve()).sendMediaMessage(input);
  }

  async sendInteractiveButtons(
    input: SendInteractiveButtonsInput,
  ): Promise<SendMessageResult> {
    return (await this.resolve()).sendInteractiveButtons(input);
  }

  async sendInteractiveList(
    input: SendInteractiveListInput,
  ): Promise<SendMessageResult> {
    return (await this.resolve()).sendInteractiveList(input);
  }

  async markAsRead(providerMessageId: string): Promise<void> {
    return (await this.resolve()).markAsRead(providerMessageId);
  }

  async verifyWebhookChallenge(
    query: Record<string, string>,
  ): Promise<string | null> {
    return (await this.resolve()).verifyWebhookChallenge(query);
  }

  async verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<boolean> {
    return (await this.resolve()).verifyWebhookSignature(
      rawBody,
      signatureHeader,
    );
  }

  parseWebhookPayload(): NormalizedInboundEvent[] {
    // Deliberately unreachable through the router — see class doc comment.
    // Kept only so this class still satisfies WhatsAppProviderPort's
    // shape for the outbound methods above, which genuinely are
    // provider-agnostic.
    throw new Error(
      'parseWebhookPayload is provider-specific — resolve the concrete provider instead of calling this through the router.',
    );
  }
}
