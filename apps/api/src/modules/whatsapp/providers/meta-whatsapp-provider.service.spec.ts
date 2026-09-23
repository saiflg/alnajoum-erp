import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MetaWhatsAppProviderService } from './meta-whatsapp-provider.service';

/**
 * Same caveat as every other real-but-unverified provider spec in this
 * codebase (duffel-flight-provider.service.spec.ts,
 * paystack-payment-provider.service.spec.ts,
 * openai-compatible-ai-provider.service.spec.ts): mocks the HTTP layer
 * against Meta's documented Cloud API response shape rather than hitting
 * a real WhatsApp Business account (no credentials available in this
 * environment) — what's verified is that requests are built correctly
 * and the documented response/webhook shapes are parsed correctly.
 */
describe('MetaWhatsAppProviderService', () => {
  let service: MetaWhatsAppProviderService;
  let fetchMock: jest.Mock;
  let integrationsService: { getCredentialConfig: jest.Mock };
  let configValues: Record<string, string>;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    integrationsService = {
      getCredentialConfig: jest.fn().mockResolvedValue(null),
    };
    configValues = {
      WHATSAPP_ACCESS_TOKEN: 'token-123',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaWhatsAppProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => configValues[key] ?? fallback,
            ),
          },
        },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();

    service = module.get(MetaWhatsAppProviderService);
  });

  describe('sendTextMessage', () => {
    it('posts the documented request shape and parses a successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.ABC' }] }),
      });

      const result = await service.sendTextMessage({
        to: '+2348031234567',
        body: 'Hello',
      });

      expect(result).toEqual({ success: true, providerMessageId: 'wamid.ABC' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
      expect(init.headers.Authorization).toBe('Bearer token-123');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual(
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '+2348031234567',
          type: 'text',
          text: { body: 'Hello', preview_url: false },
        }),
      );
    });

    it('returns a failure result (does not throw) when Meta rejects the message', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({ error: { message: 'Recipient not on WhatsApp' } }),
      });

      const result = await service.sendTextMessage({ to: '+234', body: 'Hi' });

      expect(result).toEqual({
        success: false,
        error: 'Recipient not on WhatsApp',
      });
    });

    it('throws ServiceUnavailable when no access token is configured anywhere', async () => {
      configValues = {};
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MetaWhatsAppProviderService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
          { provide: IntegrationsService, useValue: integrationsService },
        ],
      }).compile();
      const unconfigured = module.get(MetaWhatsAppProviderService);

      await expect(
        unconfigured.sendTextMessage({ to: '+234', body: 'x' }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('sendTemplateMessage', () => {
    it('builds the documented template payload with body parameters', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.T1' }] }),
      });

      await service.sendTemplateMessage({
        to: '+2348031234567',
        templateName: 'booking_confirmed',
        languageCode: 'en_US',
        variables: ['AJ-000123', '₦850,000'],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.type).toBe('template');
      expect(body.template).toEqual({
        name: 'booking_confirmed',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'AJ-000123' },
              { type: 'text', text: '₦850,000' },
            ],
          },
        ],
      });
    });
  });

  describe('sendInteractiveButtons', () => {
    it('builds the documented interactive button payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.I1' }] }),
      });

      await service.sendInteractiveButtons({
        to: '+2348031234567',
        bodyText: 'Continue?',
        buttons: [{ id: 'yes', title: 'Yes' }],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.interactive).toEqual({
        type: 'button',
        body: { text: 'Continue?' },
        action: {
          buttons: [{ type: 'reply', reply: { id: 'yes', title: 'Yes' } }],
        },
      });
    });
  });

  describe('verifyWebhookChallenge', () => {
    it('returns the challenge when mode and token match', async () => {
      const result = await service.verifyWebhookChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': 'the-challenge',
      });
      expect(result).toBe('the-challenge');
    });

    it('returns null when the verify token is wrong', async () => {
      const result = await service.verifyWebhookChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong',
        'hub.challenge': 'the-challenge',
      });
      expect(result).toBeNull();
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a correctly-signed body', async () => {
      const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
      const signature = `sha256=${createHmac('sha256', 'app-secret').update(rawBody).digest('hex')}`;

      await expect(
        service.verifyWebhookSignature(rawBody, signature),
      ).resolves.toBe(true);
    });

    it('rejects a body signed with the wrong secret', async () => {
      const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
      const signature = `sha256=${createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex')}`;

      await expect(
        service.verifyWebhookSignature(rawBody, signature),
      ).resolves.toBe(false);
    });

    it('rejects a missing signature header', async () => {
      await expect(
        service.verifyWebhookSignature(Buffer.from('x'), undefined),
      ).resolves.toBe(false);
    });

    it('rejects a malformed signature header without throwing', async () => {
      await expect(
        service.verifyWebhookSignature(Buffer.from('x'), 'sha256=not-hex-!!'),
      ).resolves.toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('normalizes a real Meta inbound-text webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.IN1',
                      from: '2348031234567',
                      timestamp: '1700000000',
                      type: 'text',
                      text: { body: 'my booking' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const [event] = service.parseWebhookPayload(payload);

      expect(event.kind).toBe('MESSAGE');
      expect(event.from).toBe('+2348031234567');
      expect(event.text).toBe('my booking');
      expect(event.messageType).toBe('TEXT');
      expect(event.providerMessageId).toBe('wamid.IN1');
    });

    it('normalizes a real Meta status-update webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.OUT1',
                      status: 'delivered',
                      timestamp: '1700000001',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const [event] = service.parseWebhookPayload(payload);

      expect(event.kind).toBe('STATUS');
      expect(event.status).toBe('DELIVERED');
      expect(event.providerMessageId).toBe('wamid.OUT1');
    });

    it('normalizes an interactive button reply', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.IN2',
                      from: '2348031234567',
                      timestamp: '1700000002',
                      type: 'interactive',
                      interactive: {
                        button_reply: { id: 'menu_1', title: 'My Bookings' },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const [event] = service.parseWebhookPayload(payload);

      expect(event.interactiveReplyId).toBe('menu_1');
    });

    it('returns an empty array for a payload with no entries (never throws)', () => {
      expect(service.parseWebhookPayload({})).toEqual([]);
    });
  });
});
