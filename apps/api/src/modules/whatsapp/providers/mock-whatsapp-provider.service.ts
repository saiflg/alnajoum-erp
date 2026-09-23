import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InteractiveButton,
  NormalizedInboundEvent,
  SendInteractiveButtonsInput,
  SendInteractiveListInput,
  SendMediaMessageInput,
  SendMessageResult,
  SendTemplateMessageInput,
  SendTextMessageInput,
  WhatsAppProviderPort,
} from './whatsapp-provider.port';

/** The shape MockWhatsAppProviderService.parseWebhookPayload understands —
 * also what the dev simulator endpoints (WhatsAppDevController) build and
 * POST at the real webhook endpoint, so a simulated inbound message runs
 * through the exact same WhatsAppWebhookService pipeline a real Meta
 * payload would (spec #69's "must be fully functional", not a shortcut
 * that skips the pipeline it's meant to exercise). */
export interface MockWebhookPayload {
  type: 'message' | 'status';
  providerMessageId?: string;
  from?: string;
  text?: string;
  interactiveReplyId?: string;
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  failureReason?: string;
}

/**
 * Phase 14 spec #2/#69 — no external credentials, no network calls. Every
 * "send" logs and returns a fake provider id immediately, exactly like
 * MockNotificationProviderService/MockFlightProviderService/MockAiProviderService
 * elsewhere in this codebase. This is what makes the whole WhatsApp
 * module (conversations, self-service menu, booking lookup, staff
 * inbox) exercisable end to end on localhost with zero Meta setup.
 */
@Injectable()
export class MockWhatsAppProviderService implements WhatsAppProviderPort {
  private readonly logger = new Logger(MockWhatsAppProviderService.name);

  private ok(
    label: string,
    to: string,
    detail: string,
  ): Promise<SendMessageResult> {
    const providerMessageId = `mock-${randomUUID()}`;
    this.logger.log(
      `[mock whatsapp ${label}] to=${to} id=${providerMessageId}\n${detail}`,
    );
    return Promise.resolve({ success: true, providerMessageId });
  }

  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    return this.ok('text', input.to, input.body);
  }

  sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult> {
    return this.ok(
      'template',
      input.to,
      `${input.templateName} (${input.languageCode}) vars=${JSON.stringify(input.variables)}`,
    );
  }

  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    return this.ok('media', input.to, `${input.kind} ${input.mediaUrl}`);
  }

  sendInteractiveButtons(
    input: SendInteractiveButtonsInput,
  ): Promise<SendMessageResult> {
    const labels = input.buttons
      .map((b: InteractiveButton) => b.title)
      .join(' | ');
    return this.ok('buttons', input.to, `${input.bodyText}\n[${labels}]`);
  }

  sendInteractiveList(
    input: SendInteractiveListInput,
  ): Promise<SendMessageResult> {
    const labels = input.rows.map((r) => r.title).join(' | ');
    return this.ok(
      'list',
      input.to,
      `${input.bodyText}\n[${input.buttonLabel}: ${labels}]`,
    );
  }

  markAsRead(providerMessageId: string): Promise<void> {
    this.logger.log(`[mock whatsapp] marked read id=${providerMessageId}`);
    return Promise.resolve();
  }

  /** No real secret to check in mock mode — echoes the challenge straight
   * back, same as Meta's own handshake would once a real token matches. */
  verifyWebhookChallenge(
    query: Record<string, string>,
  ): Promise<string | null> {
    return Promise.resolve(query['hub.challenge'] ?? null);
  }

  verifyWebhookSignature(): Promise<boolean> {
    return Promise.resolve(true);
  }

  parseWebhookPayload(body: unknown): NormalizedInboundEvent[] {
    const payload = body as MockWebhookPayload;
    const timestamp = new Date().toISOString();

    if (payload.type === 'status') {
      return [
        {
          kind: 'STATUS',
          providerMessageId: payload.providerMessageId ?? '',
          status: payload.status ?? 'SENT',
          failureReason: payload.failureReason,
          timestamp,
        },
      ];
    }

    return [
      {
        kind: 'MESSAGE',
        providerMessageId:
          payload.providerMessageId ?? `mock-in-${randomUUID()}`,
        from: payload.from,
        messageType: payload.interactiveReplyId
          ? 'INTERACTIVE_BUTTONS'
          : 'TEXT',
        text: payload.text,
        interactiveReplyId: payload.interactiveReplyId,
        timestamp,
      },
    ];
  }
}
