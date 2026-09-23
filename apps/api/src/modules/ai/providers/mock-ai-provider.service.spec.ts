import { MockAiProviderService } from './mock-ai-provider.service';

describe('MockAiProviderService', () => {
  let service: MockAiProviderService;

  beforeEach(() => {
    service = new MockAiProviderService();
  });

  interface Selection {
    query: string | null;
    params: Record<string, number>;
  }

  async function classify(question: string): Promise<Selection> {
    const result = await service.complete({
      system: 'irrelevant for the mock provider',
      prompt: question,
      jsonMode: true,
    });
    return JSON.parse(result.text) as Selection;
  }

  it('matches a total-sales question', async () => {
    const result = await classify('What were total ticket sales this month?');
    expect(result.query).toBe('total_ticket_sales');
    expect(result.params.days).toBe(30);
  });

  it('matches a top-routes question and extracts the lookback window', async () => {
    const result = await classify(
      'Which routes generated the most revenue in the last 7 days?',
    );
    expect(result.query).toBe('top_routes_by_revenue');
    expect(result.params.days).toBe(7);
  });

  it('matches a supplier-liabilities question', async () => {
    const result = await classify('How much is currently owed to suppliers?');
    expect(result.query).toBe('supplier_liabilities');
  });

  it('matches a pending-incentives question', async () => {
    const result = await classify('How much incentive is pending?');
    expect(result.query).toBe('pending_incentives');
  });

  it('matches a visa-expiry question', async () => {
    const result = await classify('Which visas are approaching expiry?');
    expect(result.query).toBe('visas_expiring_soon');
  });

  it('matches a branch-sales question over a generic route question (checked first)', async () => {
    const result = await classify('Which branches generated the most sales?');
    expect(result.query).toBe('branch_sales');
  });

  it('matches a cancelled-bookings question', async () => {
    const result = await classify('How many bookings were cancelled?');
    expect(result.query).toBe('cancelled_bookings_count');
  });

  it('extracts a "top N" limit', async () => {
    const result = await classify('Show me the top 3 routes by revenue');
    expect(result.params.limit).toBe(3);
  });

  it('returns query: null for something outside the known reports — never invents a match', async () => {
    const result = await classify("What's the weather like in Lagos today?");
    expect(result.query).toBeNull();
  });

  it('always returns valid JSON parsable by AiAnalyticsService', async () => {
    const result = await service.complete({
      system: '',
      prompt: 'anything',
      jsonMode: true,
    });
    expect(() => {
      JSON.parse(result.text);
    }).not.toThrow();
  });

  it('never fabricates an answer for a non-jsonMode (chat) request — states it has no real model', async () => {
    const result = await service.complete({ system: '', prompt: 'Hello' });
    expect(result.text.toLowerCase()).toContain('mock');
  });

  it('echoes the tail of a non-jsonMode prompt into a templated draft reply', async () => {
    const result = await service.complete({
      system: '',
      prompt:
        'You are replying to Amina Bello.\n\nCustomer\'s most recent message: "Can I move my flight to next week?"',
    });
    expect(result.text).toContain('Can I move my flight to next week?');
  });
});
