import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { AiProviderRouter } from './ai-provider.router';
import { MockAiProviderService } from './mock-ai-provider.service';
import { OpenAiCompatibleAiProviderService } from './openai-compatible-ai-provider.service';

describe('AiProviderRouter', () => {
  let router: AiProviderRouter;
  let integrationsService: { getActiveProvider: jest.Mock };
  let mockProvider: { complete: jest.Mock };
  let openAiProvider: { complete: jest.Mock };

  beforeEach(async () => {
    integrationsService = { getActiveProvider: jest.fn() };
    mockProvider = {
      complete: jest
        .fn()
        .mockResolvedValue({ text: 'from mock', provider: 'mock', model: 'm' }),
    };
    openAiProvider = {
      complete: jest.fn().mockResolvedValue({
        text: 'from openai',
        provider: 'openai-compatible',
        model: 'm',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProviderRouter,
        { provide: IntegrationsService, useValue: integrationsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock') },
        },
        { provide: MockAiProviderService, useValue: mockProvider },
        {
          provide: OpenAiCompatibleAiProviderService,
          useValue: openAiProvider,
        },
      ],
    }).compile();

    router = module.get(AiProviderRouter);
  });

  it('routes to the mock provider when it is the active one', async () => {
    integrationsService.getActiveProvider.mockResolvedValue('mock');

    const result = await router.complete({ system: '', prompt: '' });

    expect(result.text).toBe('from mock');
    expect(openAiProvider.complete).not.toHaveBeenCalled();
  });

  it('routes to the openai-compatible provider when it is active', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(
      'openai-compatible',
    );

    const result = await router.complete({ system: '', prompt: '' });

    expect(result.text).toBe('from openai');
    expect(mockProvider.complete).not.toHaveBeenCalled();
  });

  it('falls back to mock when no provider has been activated at all (spec #43)', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(null);

    const result = await router.complete({ system: '', prompt: '' });

    expect(result.text).toBe('from mock');
  });
});
