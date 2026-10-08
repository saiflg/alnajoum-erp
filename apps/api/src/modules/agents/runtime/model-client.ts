import { Injectable, Logger } from '@nestjs/common';
import { AiProviderRouter } from '../../ai/providers/ai-provider.router';
import { MockAiProviderService } from '../../ai/providers/mock-ai-provider.service';
import { AgentConfig, Confidence, ModelAction } from '../agent.types';
import { planNext, PlannerRequest } from './mock-agent-planner';

export class MalformedModelOutput extends Error {}
export class ModelUnavailable extends Error {}

const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

/** Strict parse of a model reply into one of the four allowed actions; anything else is rejected. */
export function parseModelAction(text: string): ModelAction {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let v: any;
  try {
    v = JSON.parse(cleaned);
  } catch {
    throw new MalformedModelOutput('The model did not return valid JSON');
  }
  if (!v || typeof v !== 'object')
    throw new MalformedModelOutput('The model reply was not an object');
  switch (v.action) {
    case 'tool':
      if (typeof v.tool !== 'string' || !/^[A-Za-z0-9_]{1,60}$/.test(v.tool))
        throw new MalformedModelOutput('A tool action needs a tool name');
      if (
        v.input !== undefined &&
        (typeof v.input !== 'object' ||
          Array.isArray(v.input) ||
          v.input === null)
      )
        throw new MalformedModelOutput('Tool input must be an object');
      return {
        action: 'tool',
        tool: v.tool,
        input: v.input ?? {},
        why: typeof v.why === 'string' ? v.why.slice(0, 300) : undefined,
      };
    case 'final':
      if (typeof v.text !== 'string')
        throw new MalformedModelOutput('A final answer needs text');
      return {
        action: 'final',
        text: v.text.slice(0, 6000),
        confidence: CONFIDENCES.includes(v.confidence)
          ? v.confidence
          : 'UNKNOWN',
        sources: Array.isArray(v.sources)
          ? v.sources.filter((s: unknown) => typeof s === 'string').slice(0, 10)
          : undefined,
        needsInfo: v.needsInfo === true,
      };
    case 'delegate':
      if (typeof v.agent !== 'string' || typeof v.objective !== 'string')
        throw new MalformedModelOutput(
          'A delegation needs an agent and an objective',
        );
      return {
        action: 'delegate',
        agent: v.agent,
        objective: v.objective.slice(0, 1000),
      };
    case 'handoff':
      return {
        action: 'handoff',
        reason:
          typeof v.reason === 'string' ? v.reason.slice(0, 300) : 'handoff',
      };
    default:
      throw new MalformedModelOutput(`Unknown action "${String(v.action)}"`);
  }
}

export interface ModelTurn {
  action: ModelAction;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs: number;
  failedOver: boolean;
  attempts: number;
}

const RATES = {
  // micro-dollars per 1,000 tokens (prompt, completion). The mock and the deterministic fallback cost nothing;
  // a real provider uses these defaults unless overridden in the environment.
  mock: [0, 0],
  'deterministic-fallback': [0, 0],
  real: [
    Number(process.env.AI_COST_PER_1K_PROMPT_MICROS ?? 150),
    Number(process.env.AI_COST_PER_1K_COMPLETION_MICROS ?? 600),
  ],
} as const;

export const estimateCostMicros = (
  provider: string,
  promptTokens: number,
  completionTokens: number,
): number => {
  const [p, c] =
    provider === 'mock'
      ? RATES.mock
      : provider === 'deterministic-fallback'
        ? RATES['deterministic-fallback']
        : RATES.real;
  return Math.round((promptTokens / 1000) * p + (completionTokens / 1000) * c);
};

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms} ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/**
 * One model turn, with retry and failover. Model calls only READ and PLAN, so retrying them is always safe:
 * no state changes until the runtime executes a tool, and every state-changing tool is idempotent. If the active
 * provider keeps failing, the deterministic planner (the same rules the mock uses) takes over so common read
 * questions still get a correct answer; whatever it asks for still goes through the same policy and approvals.
 */
@Injectable()
export class AiModelClient {
  private readonly logger = new Logger(AiModelClient.name);
  constructor(
    private readonly router: AiProviderRouter,
    private readonly mock: MockAiProviderService,
  ) {}

  async next(args: {
    agentKey: string;
    config: AgentConfig;
    system: string;
    payload: PlannerRequest & { agent: string };
    timeoutMs: number;
  }): Promise<ModelTurn> {
    const { config } = args;
    const prompt = JSON.stringify(args.payload);
    const providers: ('primary' | 'fallback')[] =
      config.fallbackProvider === 'none'
        ? ['primary']
        : ['primary', 'fallback'];
    let attempts = 0;
    let lastError: unknown;
    for (const which of providers) {
      const maxAttempts =
        which === 'primary' ? 1 + Math.max(0, config.maxRetries) : 1;
      for (let i = 0; i < maxAttempts; i++) {
        attempts++;
        const started = Date.now();
        try {
          if (which === 'fallback') {
            const action = planNext(args.payload);
            const promptTokens = Math.ceil(
              (args.system.length + prompt.length) / 4,
            );
            const completionTokens = Math.ceil(
              JSON.stringify(action).length / 4,
            );
            return {
              action,
              provider: 'deterministic-fallback',
              model: 'rules-v1',
              promptTokens,
              completionTokens,
              costMicros: 0,
              latencyMs: Date.now() - started,
              failedOver: true,
              attempts,
            };
          }
          const out = await withTimeout(
            (config.provider === 'mock' ? this.mock : this.router).complete({
              system: args.system,
              prompt,
              jsonMode: true,
              maxTokens: config.maxTokens,
              temperature: config.temperature,
            }),
            args.timeoutMs,
            'The AI provider',
          );
          const action = parseModelAction(out.text);
          const promptTokens =
            out.usage?.promptTokens ??
            Math.ceil((args.system.length + prompt.length) / 4);
          const completionTokens =
            out.usage?.completionTokens ?? Math.ceil(out.text.length / 4);
          return {
            action,
            provider: out.provider,
            model: out.model,
            promptTokens,
            completionTokens,
            costMicros: estimateCostMicros(
              out.provider,
              promptTokens,
              completionTokens,
            ),
            latencyMs: Date.now() - started,
            failedOver: false,
            attempts,
          };
        } catch (err) {
          lastError = err;
          this.logger.warn(
            `AI turn failed (${which}, attempt ${attempts}): ${(err as Error).message}`,
          );
        }
      }
    }
    throw new ModelUnavailable(
      `No AI provider could answer: ${(lastError as Error)?.message ?? 'unknown error'}`,
    );
  }
}
