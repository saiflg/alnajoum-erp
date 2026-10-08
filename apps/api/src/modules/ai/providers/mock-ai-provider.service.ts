import { Injectable } from '@nestjs/common';
import { planNext, PlannerRequest } from '../../agents/runtime/mock-agent-planner';
import { MockAiFaultService } from './mock-ai-faults.service';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProviderPort,
} from './ai-provider.port';

/**
 * Phase 13 spec #2/#43 — works with zero external credentials, so
 * localhost (and any deployment that hasn't configured a real AI
 * provider yet) can still exercise the whole AI layer end to end. Not a
 * real language model: for a jsonMode request (AiAnalyticsService's
 * kind) it does keyword matching against AnalyticsQueryRegistry's own
 * query names rather than free-form generation — deliberately rule-based
 * rather than a canned-response stub, so it genuinely demonstrates the
 * intent-classification flow spec #8 asks for ("convert natural-language
 * requests into safe queries"), just with pattern matching standing in
 * for a real model. A non-jsonMode request (e.g.
 * WhatsAppAiReplySuggestionService's drafting prompts) echoes the tail of
 * whatever prompt it's given back as a generic, professional-sounding
 * template — still clearly rule-based and never inventing business data,
 * but genuinely useful enough on localhost to exercise the whole feature
 * end to end, per spec #37/spec #43's "must work without a paid AI API".
 */
@Injectable()
export class MockAiProviderService implements AiProviderPort {
  constructor(private readonly faults: MockAiFaultService) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    // Phase 23: the agent runtime speaks a JSON protocol; the mock answers it with a deterministic planner.
    if (request.system.includes('ALNAJOUM_AGENT_PROTOCOL')) {
      return this.completeAgentTurn(request);
    }
    const text = request.jsonMode
      ? this.classifyAnalyticsQuestion(request.prompt)
      : this.draftReply(request.prompt);

    return Promise.resolve({
      text,
      provider: 'mock',
      model: 'mock-keyword-matcher-v1',
    });
  }

  private async completeAgentTurn(request: AiCompletionRequest): Promise<AiCompletionResult> {
    let payload: PlannerRequest & { agent: string };
    try {
      payload = JSON.parse(request.prompt) as PlannerRequest & { agent: string };
    } catch {
      throw new Error('mock provider: the agent protocol payload was not JSON');
    }
    const fault = this.faults.take(payload.agent);
    if (fault) {
      if (fault.mode === 'FAIL' || fault.mode === 'OUTAGE')
        throw new Error('mock provider: simulated provider outage');
      if (fault.mode === 'TIMEOUT')
        await new Promise((r) => setTimeout(r, fault.delayMs ?? 30_000));
      if (fault.mode === 'MALFORMED')
        return this.usage(request, '{"action": "tool", "tool": ', payload);
      if (fault.mode === 'EMPTY') return this.usage(request, '', payload);
    }
    // The objective arrives wrapped as untrusted data; the planner reads only what is inside the envelope.
    const objective = String(payload.objective ?? '')
      .replace(/^<untrusted[^>]*>\n?/, '')
      .replace(/\n?<\/untrusted>$/, '');
    const action = planNext({ ...payload, objective });
    return this.usage(request, JSON.stringify(action), payload);
  }

  /** Simulated token accounting: about one token per four characters, so budgets can be exercised. */
  private usage(request: AiCompletionRequest, text: string, _p: unknown): AiCompletionResult {
    return {
      text,
      provider: 'mock',
      model: 'mock-agent-planner-v1',
      usage: {
        promptTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
        completionTokens: Math.ceil(text.length / 4),
      },
    };
  }

  /** Deliberately format-agnostic: takes the last non-empty line of
   * whatever prompt it's given (for WhatsAppAiReplySuggestionService,
   * that's the "Customer's most recent message: ..." line it always ends
   * its prompt with) rather than parsing any caller-specific structure,
   * so this stays reusable by any future non-jsonMode caller too. If that
   * line itself ends in a quoted value ('Some label: "the actual text"'
   * — the shape every prompt in this codebase uses to hand over a quoted
   * message), unwraps just the quoted part so the draft doesn't end up
   * quoting the label along with it. */
  private draftReply(prompt: string): string {
    const lines = prompt
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      return 'Hi! Thanks for reaching out — how can we help you today? (mock AI draft: no real provider configured)';
    }
    const quoted = /"([^"]*)"\s*$/.exec(lastLine);
    const text = quoted ? quoted[1] : lastLine;
    const snippet = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    return `Thanks for your message! Regarding "${snippet}" — let me check that for you and follow up shortly. Is there anything else I can help with in the meantime? (mock AI draft: no real provider configured)`;
  }

  /** Very deliberately simple: substring/regex matching against the same
   * query names AnalyticsQueryRegistry defines, checked most-specific
   * first so "branch" doesn't fall through to the generic sales query.
   * Returns the same {query, params} JSON shape a real model is
   * instructed to produce, so AiAnalyticsService's parsing code never
   * needs to know which provider answered. */
  private classifyAnalyticsQuestion(question: string): string {
    const q = question.toLowerCase();
    const days = this.extractDays(q);
    const limit = this.extractLimit(q);

    const respond = (
      query: string | null,
      params: Record<string, number> = {},
    ) => JSON.stringify({ query, params });

    if (q.includes('visa') && (q.includes('expir') || q.includes('renew'))) {
      return respond('visas_expiring_soon', { days: days ?? 30 });
    }
    if (q.includes('incentive')) {
      return respond('pending_incentives');
    }
    if (
      q.includes('supplier') &&
      (q.includes('owe') || q.includes('liabilit') || q.includes('balance'))
    ) {
      return respond('supplier_liabilities');
    }
    if (q.includes('branch')) {
      return respond('branch_sales', { days: days ?? 30, limit: limit ?? 5 });
    }
    if (q.includes('route')) {
      return respond('top_routes_by_revenue', {
        days: days ?? 30,
        limit: limit ?? 5,
      });
    }
    if (q.includes('cancel')) {
      return respond('cancelled_bookings_count', { days: days ?? 30 });
    }
    if (
      q.includes('sale') ||
      q.includes('revenue') ||
      q.includes('ticket') ||
      q.includes('sold')
    ) {
      return respond('total_ticket_sales', { days: days ?? 30 });
    }

    return respond(null);
  }

  private extractDays(q: string): number | null {
    const explicit = /(\d+)\s*day/.exec(q);
    if (explicit) return Number(explicit[1]);
    const weeks = /(\d+)\s*week/.exec(q);
    if (weeks) return Number(weeks[1]) * 7;
    const months = /(\d+)\s*month/.exec(q);
    if (months) return Number(months[1]) * 30;
    if (q.includes('today')) return 1;
    if (q.includes('this week') || q.includes('last week')) return 7;
    if (q.includes('this month') || q.includes('last month')) return 30;
    if (q.includes('this quarter')) return 90;
    if (q.includes('this year') || q.includes('last year')) return 365;
    return null;
  }

  private extractLimit(q: string): number | null {
    const top = /top\s*(\d+)/.exec(q);
    return top ? Number(top[1]) : null;
  }
}
