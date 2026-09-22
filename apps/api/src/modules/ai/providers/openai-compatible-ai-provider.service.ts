import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProviderPort,
} from './ai-provider.port';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Real implementation against the OpenAI Chat Completions API contract
 * (https://platform.openai.com/docs/api-reference/chat) — deliberately
 * named "OpenAI-compatible" rather than just "OpenAI" because that same
 * request/response shape is what most self-hosted and third-party model
 * servers mimic (Groq, Ollama's OpenAI-compat endpoint, OpenRouter,
 * etc.), so pointing `baseUrl` at any of those works without a second
 * provider class — same reasoning DuffelFlightProviderService documents
 * for why a single class handles more than one deployment shape it's
 * compatible with.
 *
 * Honesty note, same one every other real-but-unverified provider in
 * this codebase carries (DuffelFlightProviderService, PaystackPayment
 * ProviderService): this has NOT been exercised against a live API key in
 * this environment — that needs an account only the business can create.
 * The request/response handling here follows the public documented
 * contract and is covered by a unit test that mocks the HTTP layer, but a
 * real call should be made once a key is added via /admin/integrations
 * before this is trusted for anything customer-facing.
 */
@Injectable()
export class OpenAiCompatibleAiProviderService implements AiProviderPort {
  private readonly logger = new Logger(OpenAiCompatibleAiProviderService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private async getConfig(): Promise<{
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
  }> {
    const dbConfig = await this.integrationsService.getCredentialConfig(
      'AI',
      'openai-compatible',
    );
    const apiKey =
      dbConfig?.apiKey || this.configService.get<string>('AI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'The AI provider is set to openai-compatible but no API key is configured. Add one at /admin/integrations, or switch back to Mock.',
      );
    }
    return {
      apiKey,
      baseUrl: dbConfig?.baseUrl || 'https://api.openai.com/v1',
      model: dbConfig?.model || 'gpt-4o-mini',
      temperature: dbConfig?.temperature ? Number(dbConfig.temperature) : 0.2,
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const { apiKey, baseUrl, model, temperature } = await this.getConfig();

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        temperature: request.temperature ?? temperature,
        max_tokens: request.maxTokens ?? 500,
        ...(request.jsonMode && { response_format: { type: 'json_object' } }),
      }),
    });

    const body = (await res.json()) as ChatCompletionResponse;
    const text = body.choices?.[0]?.message?.content;

    if (!res.ok || !text) {
      this.logger.error(
        `AI completion request failed: ${body.error?.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The AI assistant could not respond right now. Please try again shortly.',
      );
    }

    return {
      text,
      provider: 'openai-compatible',
      model: body.model ?? model,
      usage: {
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
      },
    };
  }
}
