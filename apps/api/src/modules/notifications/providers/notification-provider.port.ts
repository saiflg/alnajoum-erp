/** DI token — inject with `@Inject(NOTIFICATION_PROVIDER)`. */
export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';

export interface SendEmailInput {
  to: string;
  subject: string;
  textBody: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Vendor-agnostic seam for outbound notifications. Today only email exists;
 * an SMS/WhatsApp channel would extend this interface the same way, without
 * touching NotificationsService or its callers.
 */
export interface NotificationProviderPort {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
