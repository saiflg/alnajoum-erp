import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from '../../integrations/integrations.service';
import { OpenAiCompatibleAiProviderService } from './openai-compatible-ai-provider.service';

/**
 * Same caveat as duffel-flight-provider.service.spec.ts /
 * paystack-payment-provider.service.spec.ts: these mock the HTTP layer
 * against the OpenAI Chat Completions API's documented response shape
 * rather than hitting a real account (no API key available in this
 * environment) — what's verified is that requests are built correctly
 * and the documented response shape is parsed correctly.
 */
describe('OpenAiCompatibleAiProviderService', () => {
  let service: OpenAiCompatibleAiProviderService;
  let fetchMock: jest.Mock;
  let integrationsService: { getCredentialConfig: jest.Mock };

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    integrationsService = {
      getCredentialConfig: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAiCompatibleAiProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'AI_API_KEY' ? 'sk-test-dummy' : undefined,
            ),
          },
        },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();

    service = module.get(OpenAiCompatibleAiProviderService);
  });

  it('throws ServiceUnavailable when no API key is configured anywhere', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAiCompatibleAiProviderService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();
    const unconfigured = module.get(OpenAiCompatibleAiProviderService);

    await expect(
      unconfigured.complete({ system: 's', prompt: 'p' }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the system/user messages and parses a successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"query":"total_ticket_sales"}' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
    });

    const result = await service.complete({
      system: 'system instructions',
      prompt: 'total sales this month',
      jsonMode: true,
    });

    expect(result.text).toBe('{"query":"total_ticket_sales"}');
    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 10 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'total sales this month' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format when jsonMode is not requested', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: 'hello' } }] }),
    });

    await service.complete({ system: 's', prompt: 'p' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('uses a saved baseUrl/model/apiKey from IntegrationsService over env defaults', async () => {
    integrationsService.getCredentialConfig.mockResolvedValue({
      apiKey: 'sk-saved',
      baseUrl: 'https://my-proxy.example.com/v1',
      model: 'llama-3',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
    });

    await service.complete({ system: 's', prompt: 'p' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://my-proxy.example.com/v1/chat/completions');
    expect(JSON.parse(init.body as string).model).toBe('llama-3');
    expect(init.headers.Authorization).toBe('Bearer sk-saved');
  });

  it('throws ServiceUnavailable when the provider responds with an error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    });

    await expect(
      service.complete({ system: 's', prompt: 'p' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailable when the response has no message content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    });

    await expect(
      service.complete({ system: 's', prompt: 'p' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
