/**
 * Phase 14 — the WhatsApp channel abstraction. Same "swap the DI binding,
 * not the call sites" shape as FlightProviderPort/PaymentProviderPort/
 * AiProviderPort elsewhere in this codebase, so a real provider (Meta
 * today, Twilio/360Dialog/Vonage later — spec #2) is never hard-coded
 * into business logic. Distinct from NotificationProviderPort.sendWhatsApp
 * (a simple fire-and-forget text primitive already used by existing
 * reminder flows) — this is the richer, conversational surface the
 * WhatsApp module itself is built on: templates, media, interactive
 * messages, and inbound webhook handling, none of which the older
 * primitive ever needed. See WhatsAppModule's own doc comment for why
 * these two aren't unified in this pass.
 */
export interface SendTextMessageInput {
  to: string; // E.164
  body: string;
  /** Set only when replying inside Meta's 24h customer-service window is
   * not guaranteed — providers that require it use this to pick a
   * template instead of a free-form message. Left undefined for an
   * ordinary reply inside an open conversation. */
  contextMessageId?: string;
}

export interface SendTemplateMessageInput {
  to: string;
  templateName: string;
  languageCode: string;
  /** Positional {{1}}, {{2}}... values for the template's body — see
   * WhatsAppTemplateService's own validation before this is ever called. */
  variables: string[];
}

export interface SendMediaMessageInput {
  to: string;
  mediaUrl: string;
  mimeType: string;
  caption?: string;
  kind: 'IMAGE' | 'DOCUMENT' | 'VIDEO';
}

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface SendInteractiveButtonsInput {
  to: string;
  bodyText: string;
  buttons: InteractiveButton[];
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface SendInteractiveListInput {
  to: string;
  bodyText: string;
  buttonLabel: string;
  rows: InteractiveListRow[];
}

export interface SendMessageResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

/** A single inbound message or status update, normalized out of whatever
 * shape the provider's webhook payload actually used — WhatsAppWebhookService
 * only ever works with this shape, never a raw Meta payload directly. */
export interface NormalizedInboundEvent {
  kind: 'MESSAGE' | 'STATUS';
  /** Provider's own id for this specific message (for STATUS, the id of
   * the message the status applies to). */
  providerMessageId: string;
  from?: string; // E.164, present for MESSAGE
  // MESSAGE fields:
  messageType?:
    | 'TEXT'
    | 'IMAGE'
    | 'DOCUMENT'
    | 'VIDEO'
    | 'LOCATION'
    | 'INTERACTIVE_BUTTONS'
    | 'INTERACTIVE_LIST'
    | 'UNKNOWN';
  text?: string;
  mediaId?: string;
  interactiveReplyId?: string;
  timestamp: string; // ISO
  // STATUS fields:
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  failureReason?: string;
}

export interface WhatsAppProviderPort {
  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult>;
  sendInteractiveButtons(
    input: SendInteractiveButtonsInput,
  ): Promise<SendMessageResult>;
  sendInteractiveList(
    input: SendInteractiveListInput,
  ): Promise<SendMessageResult>;
  markAsRead(providerMessageId: string): Promise<void>;

  /** Verifies the provider's webhook GET verification challenge (Meta's
   * hub.verify_token handshake). Returns the challenge string to echo
   * back, or null if verification fails. */
  verifyWebhookChallenge(query: Record<string, string>): Promise<string | null>;
  /** Verifies the inbound POST's signature against the raw body — must be
   * checked before the payload is trusted at all, same discipline as
   * PaystackPaymentProviderService.verifyWebhookSignature. */
  verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<boolean>;
  /** Turns one provider-specific webhook POST body into zero or more
   * normalized events (a single Meta payload can carry several). */
  parseWebhookPayload(body: unknown): NormalizedInboundEvent[];
}
