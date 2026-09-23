import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';

describe('WhatsAppConversationsService', () => {
  let service: WhatsAppConversationsService;
  let prisma: Record<string, any>;
  let providerRouter: { sendTextMessage: jest.Mock };

  const conversation = {
    id: 'conv-1',
    companyId: 'company-a',
    phoneNumber: '+2348031234567',
    status: 'OPEN',
  };

  beforeEach(async () => {
    prisma = {
      whatsAppConversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      whatsAppMessage: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      customerTimelineEvent: { create: jest.fn() },
    };
    providerRouter = {
      sendTextMessage: jest
        .fn()
        .mockResolvedValue({ success: true, providerMessageId: 'wamid.1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppConversationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: WhatsAppProviderRouter, useValue: providerRouter },
      ],
    }).compile();

    service = module.get(WhatsAppConversationsService);
  });

  describe('get — tenant isolation', () => {
    it('404s a conversation belonging to a different company', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);

      await expect(service.get('conv-1', 'company-b')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the conversation for the same company', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);

      await expect(service.get('conv-1', 'company-a')).resolves.toEqual(
        conversation,
      );
    });

    it('applies no tenant filter for SUPER_ADMIN', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);

      await expect(service.get('conv-1')).resolves.toEqual(conversation);
    });

    it('404s a missing conversation', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOrCreateForPhone', () => {
    it('reuses an existing non-closed conversation for the same phone/company', async () => {
      prisma.whatsAppConversation.findFirst.mockResolvedValue(conversation);

      const result = await service.findOrCreateForPhone(
        'company-a',
        '+2348031234567',
      );

      expect(result).toEqual(conversation);
      expect(prisma.whatsAppConversation.create).not.toHaveBeenCalled();
    });

    it('creates a new conversation and a timeline event when a customer is matched', async () => {
      prisma.whatsAppConversation.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ assignedBranchId: null });
      prisma.whatsAppConversation.create.mockResolvedValue({ id: 'conv-new' });

      await service.findOrCreateForPhone(
        'company-a',
        '+2348031234567',
        'customer-1',
      );

      expect(prisma.whatsAppConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-a',
            customerId: 'customer-1',
          }),
        }),
      );
      expect(prisma.customerTimelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'customer-1',
            type: 'WHATSAPP_CONVERSATION_STARTED',
          }),
        }),
      );
    });

    it('does not create a timeline event when no customer is matched yet', async () => {
      prisma.whatsAppConversation.findFirst.mockResolvedValue(null);
      prisma.whatsAppConversation.create.mockResolvedValue({ id: 'conv-new' });

      await service.findOrCreateForPhone('company-a', '+2348031234567');

      expect(prisma.customerTimelineEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('sendReply', () => {
    it('sends through the provider and marks the message SENT', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);
      prisma.whatsAppMessage.create.mockResolvedValue({ id: 'msg-1' });

      const result = await service.sendReply(
        'conv-1',
        'Hello!',
        'staff-1',
        'company-a',
      );

      expect(providerRouter.sendTextMessage).toHaveBeenCalledWith({
        to: '+2348031234567',
        body: 'Hello!',
      });
      expect(result.status).toBe('SENT');
      expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerMessageId: 'wamid.1' }),
        }),
      );
    });

    it('404s a cross-tenant conversation instead of sending', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);

      await expect(
        service.sendReply('conv-1', 'Hello!', 'staff-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(providerRouter.sendTextMessage).not.toHaveBeenCalled();
    });

    it('marks the message FAILED when the provider send fails', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);
      prisma.whatsAppMessage.create.mockResolvedValue({ id: 'msg-1' });
      providerRouter.sendTextMessage.mockResolvedValue({
        success: false,
        error: 'timeout',
      });

      const result = await service.sendReply(
        'conv-1',
        'Hello!',
        'staff-1',
        'company-a',
      );

      expect(result.status).toBe('FAILED');
      expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: 'timeout',
          }),
        }),
      );
    });
  });

  describe('sendAutomatedMessage — idempotency + consent (spec #43/#51)', () => {
    it('is a no-op when the idempotency key was already used', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue({ id: 'existing' });

      const result = await service.sendAutomatedMessage(
        'company-a',
        '+2348031234567',
        'Your ticket is ready',
        'booking-ticketed:booking-1',
      );

      expect(result).toEqual({ sent: false, reason: 'already_sent' });
      expect(providerRouter.sendTextMessage).not.toHaveBeenCalled();
    });

    it('refuses to send to a customer who has not opted in', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ whatsappOptIn: false });

      const result = await service.sendAutomatedMessage(
        'company-a',
        '+2348031234567',
        'Reminder',
        'installment-reminder:inst-1',
        'customer-1',
      );

      expect(result).toEqual({ sent: false, reason: 'not_opted_in' });
      expect(providerRouter.sendTextMessage).not.toHaveBeenCalled();
    });

    it('sends when opted in and the key is fresh', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({
        whatsappOptIn: true,
        assignedBranchId: null,
      });
      prisma.whatsAppConversation.findFirst.mockResolvedValue(conversation);
      prisma.whatsAppMessage.create.mockResolvedValue({ id: 'msg-1' });

      const result = await service.sendAutomatedMessage(
        'company-a',
        '+2348031234567',
        'Reminder',
        'installment-reminder:inst-1',
        'customer-1',
      );

      expect(result.sent).toBe(true);
      expect(providerRouter.sendTextMessage).toHaveBeenCalled();
    });

    it('sends with no consent check when no customerId is given (e.g. an unmatched-number automated flow)', async () => {
      prisma.whatsAppMessage.findUnique.mockResolvedValue(null);
      prisma.whatsAppConversation.findFirst.mockResolvedValue(conversation);
      prisma.whatsAppMessage.create.mockResolvedValue({ id: 'msg-1' });

      const result = await service.sendAutomatedMessage(
        'company-a',
        '+2348031234567',
        'Reminder',
        'key-1',
      );

      expect(result.sent).toBe(true);
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('addInternalNote', () => {
    it('stores the note as isInternalNote without calling the provider', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);
      prisma.whatsAppMessage.create.mockResolvedValue({
        id: 'note-1',
        isInternalNote: true,
      });

      await service.addInternalNote(
        'conv-1',
        'Urgent visa case',
        'staff-1',
        'company-a',
      );

      expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isInternalNote: true,
            content: 'Urgent visa case',
          }),
        }),
      );
      expect(providerRouter.sendTextMessage).not.toHaveBeenCalled();
    });
  });

  describe('assign / setStatus / setAutomationPaused', () => {
    it('assign() 404s a cross-tenant conversation', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);

      await expect(
        service.assign('conv-1', 'staff-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('setAutomationPaused() sets the flag for the same-tenant conversation', async () => {
      prisma.whatsAppConversation.findUnique.mockResolvedValue(conversation);
      prisma.whatsAppConversation.update.mockResolvedValue({
        ...conversation,
        automationPaused: true,
      });

      const result = await service.setAutomationPaused(
        'conv-1',
        true,
        'company-a',
      );

      expect(result.automationPaused).toBe(true);
    });
  });
});
