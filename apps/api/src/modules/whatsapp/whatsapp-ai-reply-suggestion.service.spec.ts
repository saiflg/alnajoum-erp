import { Test, TestingModule } from '@nestjs/testing';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { AiUsageService } from '../ai/ai-usage.service';
import { AiProviderRouter } from '../ai/providers/ai-provider.router';
import { WhatsAppAiReplySuggestionService } from './whatsapp-ai-reply-suggestion.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';

const companyAdmin: AuthContext = {
  sub: 'identity-1',
  type: 'STAFF',
  roles: ['COMPANY_ADMIN'],
  permissions: [],
  companyId: 'company-a',
  sessionId: null,
};

const conversation = {
  id: 'conv-1',
  companyId: 'company-a',
  language: null,
  customer: {
    firstName: 'Amina',
    lastName: 'Bello',
    preferredLanguage: 'en',
  },
};

const messages = [
  {
    id: 'msg-2',
    direction: 'INBOUND',
    content: 'Can I move my flight to next week?',
    isInternalNote: false,
    createdAt: new Date('2026-01-02'),
  },
  {
    id: 'msg-1',
    direction: 'OUTBOUND',
    content: 'Hi Amina, how can we help?',
    isInternalNote: false,
    createdAt: new Date('2026-01-01'),
  },
];

describe('WhatsAppAiReplySuggestionService', () => {
  let service: WhatsAppAiReplySuggestionService;
  let conversationsService: {
    get: jest.Mock;
    listMessages: jest.Mock;
  };
  let aiProviderRouter: { complete: jest.Mock };
  let usageService: { enforceDailyLimit: jest.Mock; log: jest.Mock };

  beforeEach(async () => {
    conversationsService = {
      get: jest.fn().mockResolvedValue(conversation),
      listMessages: jest.fn().mockResolvedValue(messages),
    };
    aiProviderRouter = {
      complete: jest.fn().mockResolvedValue({
        text: 'Sure, let me check available dates for you.',
        provider: 'mock',
        model: 'mock-keyword-matcher-v1',
      }),
    };
    usageService = {
      enforceDailyLimit: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppAiReplySuggestionService,
        {
          provide: WhatsAppConversationsService,
          useValue: conversationsService,
        },
        { provide: AiProviderRouter, useValue: aiProviderRouter },
        { provide: AiUsageService, useValue: usageService },
      ],
    }).compile();

    service = module.get(WhatsAppAiReplySuggestionService);
  });

  it('enforces the daily usage limit before calling the AI provider', async () => {
    usageService.enforceDailyLimit.mockRejectedValue(
      new Error('limit reached'),
    );

    await expect(service.suggestReply('conv-1', companyAdmin)).rejects.toThrow(
      'limit reached',
    );
    expect(aiProviderRouter.complete).not.toHaveBeenCalled();
  });

  it('is tenant-scoped through WhatsAppConversationsService.get()', async () => {
    await service.suggestReply('conv-1', companyAdmin);
    expect(conversationsService.get).toHaveBeenCalledWith(
      'conv-1',
      'company-a',
    );
  });

  it('builds a transcript from the conversation and returns the drafted suggestion', async () => {
    const result = await service.suggestReply('conv-1', companyAdmin);

    expect(result).toEqual({
      suggestion: 'Sure, let me check available dates for you.',
      provider: 'mock',
      model: 'mock-keyword-matcher-v1',
    });
    const [[request]] = aiProviderRouter.complete.mock.calls;
    expect(request.prompt).toContain('Amina Bello');
    expect(request.prompt).toContain(
      'Customer: Can I move my flight to next week?',
    );
    expect(request.prompt).toContain('Staff: Hi Amina, how can we help?');
    expect(request.prompt).toContain(
      'Customer\'s most recent message: "Can I move my flight to next week?"',
    );
  });

  it('excludes internal notes from the transcript sent to the AI provider', async () => {
    conversationsService.listMessages.mockResolvedValue([
      ...messages,
      {
        id: 'note-1',
        direction: 'OUTBOUND',
        content: 'Customer sounded upset on the call',
        isInternalNote: true,
        createdAt: new Date('2026-01-03'),
      },
    ]);

    await service.suggestReply('conv-1', companyAdmin);

    const [[request]] = aiProviderRouter.complete.mock.calls;
    expect(request.prompt).not.toContain('Customer sounded upset');
  });

  it('never calls the WhatsApp provider — only drafts text', async () => {
    await service.suggestReply('conv-1', companyAdmin);
    // No provider dependency is even injected into this service — a
    // structural guarantee, not just a runtime assertion, that a
    // suggestion can never itself send a message.
    expect(Object.keys(service)).not.toContain('providerRouter');
  });

  it('logs usage on success and on failure, without ever including the drafted text as the logged "question"', async () => {
    await service.suggestReply('conv-1', companyAdmin);
    expect(usageService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'whatsapp_reply_suggestion',
        status: 'MATCHED',
        question: 'Reply suggestion for conversation conv-1',
      }),
    );

    usageService.log.mockClear();
    aiProviderRouter.complete.mockRejectedValue(new Error('provider down'));
    await expect(service.suggestReply('conv-1', companyAdmin)).rejects.toThrow(
      'provider down',
    );
    expect(usageService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'whatsapp_reply_suggestion',
        status: 'ERROR',
        errorMessage: 'provider down',
      }),
    );
  });
});
