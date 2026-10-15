/** DI token — inject with `@Inject(NOTIFICATION_PROVIDER)`. */
export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';

export interface SendEmailInput {
  to: string;
  subject: string;
  textBody: string;
  /** Phase 26: an HTML alternative, extra headers (List-Unsubscribe ...), a reply-to and a sender override. */
  html?: string;
  headers?: Record<string, string>;
  replyTo?: string;
  /** Display name for the From header; the address itself stays the provider's configured one. */
  fromName?: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  /** The provider's own id for the message, when it gives one (used to match bounces and complaints later). */
  providerMessageId?: string;
  /** True when nothing really left the machine (the built-in mock). Reports must say so. */
  simulated?: boolean;
}

export interface SendTextInput {
  /** Phone number in whatever format it was stored (E.164 expected but not enforced). */
  to: string;
  body: string;
}

export interface SendTextResult {
  success: boolean;
  error?: string;
}

/**
 * Vendor-agnostic seam for outbound notifications across every channel the
 * platform sends on. Same "swap the DI binding, not the call sites"
 * shape as PaymentProviderPort/FlightProviderPort — sendSms/sendWhatsApp
 * exist alongside sendEmail rather than as an afterthought, since Phase 2
 * needs all three (see NotificationsService.sendInstallmentReminder /
 * sendDocumentMissingReminder, the two notification types that actually
 * go out on more than one channel).
 */
export interface NotificationProviderPort {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
  sendSms(input: SendTextInput): Promise<SendTextResult>;
  sendWhatsApp(input: SendTextInput): Promise<SendTextResult>;
}
