import { Injectable } from '@nestjs/common';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProviderPort,
} from './ai-provider.port';

/**
 * Phase 13 spec #2/#43 — works with zero external credentials, so
 * localhost (and any deployment that hasn't configured a real AI
 * provider yet) can still exercise the whole AI layer end to end. Not a
 * real language model: for a jsonMode request (the only kind
 * AiAnalyticsService currently sends) it does keyword matching against
 * AnalyticsQueryRegistry's own query names rather than free-form
 * generation — deliberately rule-based rather than a canned-response
 * stub, so it genuinely demonstrates the intent-classification flow spec
 * #8 asks for ("convert natural-language requests into safe queries"),
 * just with pattern matching standing in for a real model. A non-jsonMode
 * request (future chat-style assistants) gets a plain, honest "no real
 * model configured" reply rather than an invented answer — never
 * fabricates business data, per spec #37.
 */
@Injectable()
export class MockAiProviderService implements AiProviderPort {
  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const text = request.jsonMode
      ? this.classifyAnalyticsQuestion(request.prompt)
      : "I'm running in mock mode (no real AI provider configured) — I can only help with the structured reports listed in the Analytics assistant, not open-ended conversation yet.";

    return Promise.resolve({
      text,
      provider: 'mock',
      model: 'mock-keyword-matcher-v1',
    });
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
