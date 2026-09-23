import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
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

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: { message?: string };
}

interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  webhookVerifyToken: string;
  apiVersion: string;
}

/**
 * Real implementation against Meta's documented WhatsApp Cloud API
 * (https://developers.facebook.com/docs/whatsapp/cloud-api) — POST
 * /{phone-number-id}/messages for every outbound send, the app-secret
 * HMAC-SHA256 signature scheme (X-Hub-Signature-256) for inbound webhook
 * verification, and the hub.challenge GET handshake for the initial
 * webhook subscription.
 *
 * Honesty note, the same one every other real-but-unverified provider in
 * this codebase carries (DuffelFlightProviderService,
 * PaystackPaymentProviderService, OpenAiCompatibleAiProviderService):
 * this has NOT been exercised against a live Meta Business/WhatsApp
 * account in this environment — that needs a Meta Business Manager
 * account, a verified WhatsApp Business phone number, and Meta's own
 * template-approval process, none of which can be created here. The
 * request/response handling follows Meta's public documented contract
 * and is covered by unit tests that mock the HTTP layer, but a real
 * test-number send and a real webhook delivery should be exercised once
 * credentials are added via /admin/integrations before this is trusted
 * for real customer traffic.
 */
@Injectable()
export class MetaWhatsAppProviderService implements WhatsAppProviderPort {
  private readonly logger = new Logger(MetaWhatsAppProviderService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private async getConfig(): Promise<MetaConfig> {
    const dbConfig = await this.integrationsService.getCredentialConfig(
      'WHATSAPP',
      'meta',
    );
    const accessToken =
      dbConfig?.accessToken ||
      this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId =
      dbConfig?.phoneNumberId ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const appSecret =
      dbConfig?.appSecret ||
      this.configService.get<string>('WHATSAPP_APP_SECRET');
    const webhookVerifyToken =
      dbConfig?.webhookVerifyToken ||
      this.configService.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (!accessToken || !phoneNumberId) {
      throw new ServiceUnavailableException(
        'The WhatsApp provider is set to Meta but no access token/phone number id is configured. Add them at /admin/integrations, or switch back to Mock.',
      );
    }
    return {
      accessToken,
      phoneNumberId,
      appSecret: appSecret ?? '',
      webhookVerifyToken: webhookVerifyToken ?? '',
      apiVersion:
        dbConfig?.apiVersion ||
        this.configService.get<string>('WHATSAPP_API_VERSION', 'v21.0'),
    };
  }

  private async post(
    body: Record<string, unknown>,
  ): Promise<SendMessageResult> {
    const { accessToken, phoneNumberId, apiVersion } = await this.getConfig();
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      },
    );
    const responseBody = (await res.json()) as MetaSendResponse;
    if (!res.ok || !responseBody.messages?.[0]?.id) {
      const message = responseBody.error?.message ?? res.statusText;
      this.logger.error(`WhatsApp send failed: ${message}`);
      return { success: false, error: message };
    }
    return { success: true, providerMessageId: responseBody.messages[0].id };
  }

  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    return this.post({
      to: input.to,
      type: 'text',
      text: { body: input.body, preview_url: false },
      ...(input.contextMessageId && {
        context: { message_id: input.contextMessageId },
      }),
    });
  }

  sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult> {
    return this.post({
      to: input.to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components:
          input.variables.length > 0
            ? [
                {
                  type: 'body',
                  parameters: input.variables.map((text) => ({
                    type: 'text',
                    text,
                  })),
                },
              ]
            : undefined,
      },
    });
  }

  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    const field = input.kind.toLowerCase();
    return this.post({
      to: input.to,
      type: field,
      [field]: { link: input.mediaUrl, caption: input.caption },
    });
  }

  sendInteractiveButtons(
    input: SendInteractiveButtonsInput,
  ): Promise<SendMessageResult> {
    return this.post({
      to: input.to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: input.bodyText },
        action: {
          buttons: input.buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  sendInteractiveList(
    input: SendInteractiveListInput,
  ): Promise<SendMessageResult> {
    return this.post({
      to: input.to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: input.bodyText },
        action: {
          button: input.buttonLabel,
          sections: [{ rows: input.rows }],
        },
      },
    });
  }

  async markAsRead(providerMessageId: string): Promise<void> {
    await this.post({ status: 'read', message_id: providerMessageId });
  }

  async verifyWebhookChallenge(
    query: Record<string, string>,
  ): Promise<string | null> {
    const { webhookVerifyToken } = await this.getConfig();
    if (
      query['hub.mode'] === 'subscribe' &&
      webhookVerifyToken &&
      query['hub.verify_token'] === webhookVerifyToken
    ) {
      return query['hub.challenge'] ?? null;
    }
    return null;
  }

  async verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<boolean> {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const { appSecret } = await this.getConfig();
    if (!appSecret) return false;

    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const providedHex = signatureHeader.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(providedHex, 'hex');
    return (
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf)
    );
  }

  parseWebhookPayload(body: unknown): NormalizedInboundEvent[] {
    const events: NormalizedInboundEvent[] = [];
    const payload = body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id: string;
              from: string;
              timestamp: string;
              type: string;
              text?: { body: string };
              interactive?: {
                button_reply?: { id: string; title: string };
                list_reply?: { id: string; title: string };
              };
              image?: { id: string };
              document?: { id: string };
              video?: { id: string };
              location?: { latitude: number; longitude: number };
            }>;
            statuses?: Array<{
              id: string;
              status: string;
              timestamp: string;
              errors?: Array<{ title?: string }>;
            }>;
          };
        }>;
      }>;
    };

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          const interactiveReplyId =
            message.interactive?.button_reply?.id ??
            message.interactive?.list_reply?.id;
          events.push({
            kind: 'MESSAGE',
            providerMessageId: message.id,
            from: message.from.startsWith('+')
              ? message.from
              : `+${message.from}`,
            messageType: this.mapMessageType(message.type),
            text: message.text?.body,
            mediaId:
              message.image?.id ?? message.document?.id ?? message.video?.id,
            interactiveReplyId,
            timestamp: new Date(Number(message.timestamp) * 1000).toISOString(),
          });
        }
        for (const status of change.value?.statuses ?? []) {
          events.push({
            kind: 'STATUS',
            providerMessageId: status.id,
            status: this.mapStatus(status.status),
            failureReason: status.errors?.[0]?.title,
            timestamp: new Date(Number(status.timestamp) * 1000).toISOString(),
          });
        }
      }
    }
    return events;
  }

  private mapMessageType(type: string): NormalizedInboundEvent['messageType'] {
    switch (type) {
      case 'text':
        return 'TEXT';
      case 'image':
        return 'IMAGE';
      case 'document':
        return 'DOCUMENT';
      case 'video':
        return 'VIDEO';
      case 'location':
        return 'LOCATION';
      case 'interactive':
        return 'INTERACTIVE_BUTTONS';
      default:
        return 'UNKNOWN';
    }
  }

  private mapStatus(status: string): NormalizedInboundEvent['status'] {
    switch (status) {
      case 'sent':
        return 'SENT';
      case 'delivered':
        return 'DELIVERED';
      case 'read':
        return 'READ';
      case 'failed':
        return 'FAILED';
      default:
        return 'SENT';
    }
  }
}
