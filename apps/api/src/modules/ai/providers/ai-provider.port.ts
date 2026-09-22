/**
 * Phase 13 — the AI abstraction layer. Every concrete provider (mock, a
 * real OpenAI-compatible API, or anything added later) implements this
 * same narrow interface, so nothing above this layer (AiAnalyticsService,
 * and whatever assistant is built on top of it next) ever hard-codes a
 * specific vendor — same reasoning as FlightProviderPort/
 * PaymentProviderPort elsewhere in this codebase.
 */
export interface AiCompletionRequest {
  /** Instructions/constraints — never shown to the end user. */
  system: string;
  /** The caller's own question/prompt. */
  prompt: string;
  /** When true, the provider must return ONLY a JSON object (no prose,
   * no markdown fences) — used for the structured query-selection step,
   * never for free-text chat. */
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface AiProviderPort {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}
