import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProviderPort,
} from './ai-provider.port';
import { MockAiProviderService } from './mock-ai-provider.service';
import { OpenAiCompatibleAiProviderService } from './openai-compatible-ai-provider.service';

/**
 * Resolves which concrete AiProviderPort implementation handles each
 * call, checked fresh every time rather than fixed at boot — same
 * pattern as FlightProviderRouter, so activating a real AI provider at
 * /admin/integrations takes effect on the very next request. Falls back
 * to the AI_PROVIDER env var, then to "mock", so a deployment that has
 * never touched the settings UI (every localhost checkout, spec #43)
 * still works with zero configuration.
 */
@Injectable()
export class AiProviderRouter implements AiProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockAiProviderService,
    private readonly openAiCompatibleProvider: OpenAiCompatibleAiProviderService,
  ) {}

  private async resolve(): Promise<AiProviderPort> {
    const active = await this.integrationsService.getActiveProvider('AI');
    const providerName =
      active ?? this.configService.get<string>('AI_PROVIDER', 'mock');
    return providerName === 'openai-compatible'
      ? this.openAiCompatibleProvider
      : this.mockProvider;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    return (await this.resolve()).complete(request);
  }
}
