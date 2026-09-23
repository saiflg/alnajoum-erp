import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NormalizedInboundEvent } from './providers/whatsapp-provider.port';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';
import { WhatsAppConsentService } from './whatsapp-consent.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { WhatsAppSelfServiceService } from './whatsapp-self-service.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

const conversation = {
  id: 'conv-1',
  companyId: 'company-a',
  phoneNumber: '+2348031234567',
  automationPaused: false,
};

function textEvent(
  text: string,
  providerMessageId = 'wamid.in1',
): NormalizedInboundEvent {
  return {
    kind: 'MESSAGE',
    providerMessageId,
    from: '+2348031234567',
    messageType: 'TEXT',
    text,
    timestamp: new Date().toISOString(),
  };
}

describe('WhatsAppWebhookService', () => {
  let service: WhatsAppWebhookService;
  let prisma: Record<string, any>;
  let conversationsService: Record<string, jest.Mock>;
  let consentService: { recordConsent: jest.Mock };
  let otpService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let selfService: Record<string, any>;
  let providerRouter: { sendTextMessage: jest.Mock };

  beforeEach(async () => {
    prisma = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-a' }) },
      whatsAppWebhookEvent: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        update: jest.fn(),
      },
      whatsAppConversation: {
        update: jest.fn().mockResolvedValue({}),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    conversationsService = {
      findOrCreateForPhone: jest.fn().mockResolvedValue(conversation),
      get: jest.fn().mockResolvedValue(conversation),
      setStatus: jest.fn().mockResolvedValue({}),
    };
    consentService = { recordConsent: jest.fn().mockResolvedValue({}) };
    otpService = {
      requestOtp: jest.fn().mockResolvedValue('123456'),
      verifyOtp: jest.fn(),
    };
    selfService = {
      findVerifiedCustomer: jest.fn().mockResolvedValue(null),
      welcomeMenu: jest.fn().mockReturnValue('WELCOME_MENU'),
      help: jest.fn().mockReturnValue('HELP_TEXT'),
      myBookings: jest.fn().mockResolvedValue('BOOKING: AJ-1'),
    };
    providerRouter = {
      sendTextMessage: jest
        .fn()
        .mockResolvedValue({ success: true, providerMessageId: 'wamid.out1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppWebhookService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WhatsAppConversationsService,
          useValue: conversationsService,
        },
        { provide: WhatsAppConsentService, useValue: consentService },
        { provide: WhatsAppOtpService, useValue: otpService },
        { provide: WhatsAppSelfServiceService, useValue: selfService },
        { provide: WhatsAppProviderRouter, useValue: providerRouter },
      ],
    }).compile();

    service = module.get(WhatsAppWebhookService);
  });

  describe('recordEventOnceOrSkip — idempotency (spec #12/#43)', () => {
    it('returns true and records the event on first delivery', async () => {
      prisma.whatsAppWebhookEvent.create.mockResolvedValue({});

      const isNew = await service.recordEventOnceOrSkip('meta', 'wamid.1', {
        a: 1,
      });

      expect(isNew).toBe(true);
      expect(prisma.whatsAppWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'meta',
            eventId: 'wamid.1',
          }),
        }),
      );
    });

    it('returns false on a redelivered event (unique constraint violation)', async () => {
      prisma.whatsAppWebhookEvent.create.mockRejectedValue(
        new Error('Unique constraint failed'),
      );

      const isNew = await service.recordEventOnceOrSkip('meta', 'wamid.1', {
        a: 1,
      });

      expect(isNew).toBe(false);
    });
  });

  describe('processEvent — status updates', () => {
    it('updates the matching message to DELIVERED', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue({ id: 'msg-1' });

      await service.processEvent({
        kind: 'STATUS',
        providerMessageId: 'wamid.out1',
        status: 'DELIVERED',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('is a no-op when the status refers to an unknown message', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue(null);

      await service.processEvent({
        kind: 'STATUS',
        providerMessageId: 'unknown',
        status: 'READ',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
    });
  });

  describe('processEvent — consent commands', () => {
    it('records an opt-out on STOP and confirms it', async () => {
      await service.processEvent(textEvent('STOP'));

      expect(consentService.recordConsent).toHaveBeenCalledWith(
        '+2348031234567',
        'OPTED_OUT',
        'whatsapp_stop_command',
        undefined,
      );
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('unsubscribed'),
        }),
      );
    });

    it('records an opt-in on START and confirms it', async () => {
      await service.processEvent(textEvent('START'));

      expect(consentService.recordConsent).toHaveBeenCalledWith(
        '+2348031234567',
        'OPTED_IN',
        'whatsapp_start_command',
        undefined,
      );
    });
  });

  describe('processEvent — automation pause (spec #85)', () => {
    it('stores the inbound message but sends no automated reply when automation is paused', async () => {
      conversationsService.findOrCreateForPhone.mockResolvedValue({
        ...conversation,
        automationPaused: true,
      });

      await service.processEvent(textEvent('menu'));

      expect(prisma.whatsAppMessage.create).toHaveBeenCalled(); // inbound stored
      expect(providerRouter.sendTextMessage).not.toHaveBeenCalled(); // no auto-reply
    });
  });

  describe('processEvent — self-service commands', () => {
    it('replies with the welcome menu for "menu"', async () => {
      await service.processEvent(textEvent('menu'));

      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'WELCOME_MENU' }),
      );
    });

    it('replies with help text for "help"', async () => {
      await service.processEvent(textEvent('help'));

      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'HELP_TEXT' }),
      );
    });

    it('sets status to WAITING_STAFF and confirms handoff on "agent"', async () => {
      await service.processEvent(textEvent('agent'));

      expect(conversationsService.setStatus).toHaveBeenCalledWith(
        'conv-1',
        'WAITING_STAFF',
      );
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('connected to our support team'),
        }),
      );
    });

    it('falls back to the welcome menu for an unrecognized message', async () => {
      await service.processEvent(textEvent('asdkjasjdk nonsense'));

      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'WELCOME_MENU' }),
      );
    });
  });

  describe('processEvent — booking lookup verification gate (spec #7/#16)', () => {
    it('answers directly when the customer is already verified', async () => {
      selfService.findVerifiedCustomer.mockResolvedValue({ id: 'customer-1' });

      await service.processEvent(textEvent('my booking'));

      expect(selfService.myBookings).toHaveBeenCalledWith('customer-1');
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'BOOKING: AJ-1' }),
      );
      expect(otpService.requestOtp).not.toHaveBeenCalled();
    });

    it('starts an OTP challenge when an unverified customer with this number exists', async () => {
      selfService.findVerifiedCustomer.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });

      await service.processEvent(textEvent('my booking'));

      expect(otpService.requestOtp).toHaveBeenCalledWith(
        '+2348031234567',
        'customer-1',
      );
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('123456') }),
      );
    });

    it('never reveals booking data for a phone number with no matching customer at all', async () => {
      selfService.findVerifiedCustomer.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);

      await service.processEvent(textEvent('my booking'));

      expect(selfService.myBookings).not.toHaveBeenCalled();
      expect(otpService.requestOtp).not.toHaveBeenCalled();
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("couldn't find an account"),
        }),
      );
    });

    it('completes verification on a correct 6-digit reply and then answers the original request', async () => {
      selfService.findVerifiedCustomer.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
      otpService.verifyOtp.mockResolvedValue(true);

      await service.processEvent(textEvent('654321'));

      expect(otpService.verifyOtp).toHaveBeenCalledWith(
        '+2348031234567',
        '654321',
      );
      expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: { customerId: 'customer-1' },
        }),
      );
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('BOOKING: AJ-1'),
        }),
      );
    });

    it('rejects a wrong 6-digit code without linking the conversation', async () => {
      selfService.findVerifiedCustomer.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
      otpService.verifyOtp.mockResolvedValue(false);

      await service.processEvent(textEvent('000000'));

      expect(prisma.whatsAppConversation.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { customerId: 'customer-1' } }),
      );
      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("didn't match"),
        }),
      );
    });
  });
});
