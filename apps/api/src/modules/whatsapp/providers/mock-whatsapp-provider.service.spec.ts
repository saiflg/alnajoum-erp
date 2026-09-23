import { MockWhatsAppProviderService } from './mock-whatsapp-provider.service';

describe('MockWhatsAppProviderService', () => {
  let service: MockWhatsAppProviderService;

  beforeEach(() => {
    service = new MockWhatsAppProviderService();
  });

  it('sendTextMessage succeeds with a fake provider id', async () => {
    const result = await service.sendTextMessage({
      to: '+2348031234567',
      body: 'hello',
    });
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock-/);
  });

  it('sendTemplateMessage succeeds', async () => {
    const result = await service.sendTemplateMessage({
      to: '+2348031234567',
      templateName: 'booking_confirmed',
      languageCode: 'en',
      variables: ['AJ-123'],
    });
    expect(result.success).toBe(true);
  });

  it('sendMediaMessage succeeds', async () => {
    const result = await service.sendMediaMessage({
      to: '+2348031234567',
      mediaUrl: 'https://example.com/ticket.pdf',
      mimeType: 'application/pdf',
      kind: 'DOCUMENT',
    });
    expect(result.success).toBe(true);
  });

  it('sendInteractiveButtons succeeds', async () => {
    const result = await service.sendInteractiveButtons({
      to: '+2348031234567',
      bodyText: 'Continue?',
      buttons: [{ id: 'yes', title: 'Yes' }],
    });
    expect(result.success).toBe(true);
  });

  it('markAsRead resolves without error', async () => {
    await expect(service.markAsRead('mock-1')).resolves.toBeUndefined();
  });

  describe('verifyWebhookChallenge', () => {
    it('echoes hub.challenge back — no real secret required in mock mode', async () => {
      const result = await service.verifyWebhookChallenge({
        'hub.challenge': 'abc123',
      });
      expect(result).toBe('abc123');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('always returns true — no real signing in mock mode', async () => {
      await expect(service.verifyWebhookSignature()).resolves.toBe(true);
    });
  });

  describe('parseWebhookPayload', () => {
    it('normalizes a simulated inbound text message', () => {
      const [event] = service.parseWebhookPayload({
        type: 'message',
        from: '+2348031234567',
        text: 'hello',
      });
      expect(event.kind).toBe('MESSAGE');
      expect(event.from).toBe('+2348031234567');
      expect(event.text).toBe('hello');
      expect(event.messageType).toBe('TEXT');
    });

    it('normalizes a simulated interactive button reply', () => {
      const [event] = service.parseWebhookPayload({
        type: 'message',
        from: '+2348031234567',
        interactiveReplyId: 'menu_1',
      });
      expect(event.messageType).toBe('INTERACTIVE_BUTTONS');
      expect(event.interactiveReplyId).toBe('menu_1');
    });

    it('normalizes a simulated status update', () => {
      const [event] = service.parseWebhookPayload({
        type: 'status',
        providerMessageId: 'mock-1',
        status: 'DELIVERED',
      });
      expect(event.kind).toBe('STATUS');
      expect(event.status).toBe('DELIVERED');
      expect(event.providerMessageId).toBe('mock-1');
    });
  });
});
