/**
 * The seam between the WhatsApp module and the AI agent layer. WhatsApp depends only on this interface, so it
 * never imports the agent runtime, and the AI layer can be absent (the bot then behaves exactly as before).
 */
export const AI_WHATSAPP_BRIDGE = 'AI_WHATSAPP_BRIDGE';

export interface AiWhatsAppBridge {
  /**
   * Tries to answer a verified customer's message with the customer assistant.
   * `handled: false` means "not eligible, use the normal bot" (AI off for WhatsApp, no consent, ...).
   */
  tryReply(args: {
    companyId: string;
    customerId: string;
    phoneNumber: string;
    text: string;
  }): Promise<{ handled: boolean; message?: string; handoff?: boolean }>;
}
