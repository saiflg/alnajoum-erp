export interface AnalyticsQueryParamSpec {
  name: string;
  description: string;
  default: number;
  min: number;
  max: number;
}

export interface AnalyticsQuerySpec {
  name: string;
  description: string;
  params: AnalyticsQueryParamSpec[];
}

const DAYS_PARAM: AnalyticsQueryParamSpec = {
  name: 'days',
  description: 'lookback window in days',
  default: 30,
  min: 1,
  max: 365,
};

const LIMIT_PARAM: AnalyticsQueryParamSpec = {
  name: 'limit',
  description: 'how many top results to return',
  default: 5,
  min: 1,
  max: 20,
};

/**
 * Phase 13 spec #8/#31 — the ONLY analytical questions the AI layer can
 * answer. This is the "controlled query layer" the spec asks for
 * instead of AI-generated SQL: the AI's only job is to pick a `name`
 * from this exact list and fill in `params` (validated/clamped against
 * each spec below before anything runs) — AiAnalyticsService rejects any
 * name that isn't in this array outright, so there is no path from a
 * user's free-text question to an arbitrary database query, no matter
 * what a provider (mock or real) returns. Every execution behind a name
 * here lives in AiAnalyticsService and always applies the caller's own
 * tenant scope (resolveTenantFilter) — the registry only names and
 * describes queries, it never runs them.
 */
export const ANALYTICS_QUERY_REGISTRY: AnalyticsQuerySpec[] = [
  {
    name: 'total_ticket_sales',
    description:
      'Total flight ticket sales revenue (confirmed/ticketed bookings) over a period.',
    params: [DAYS_PARAM],
  },
  {
    name: 'top_routes_by_revenue',
    description: 'Which flight routes generated the most revenue.',
    params: [DAYS_PARAM, LIMIT_PARAM],
  },
  {
    name: 'supplier_liabilities',
    description:
      'How much is currently owed to flight suppliers (outstanding payables).',
    params: [],
  },
  {
    name: 'pending_incentives',
    description: 'Total staff incentive amount approved but not yet paid out.',
    params: [],
  },
  {
    name: 'visas_expiring_soon',
    description:
      'How many visa documents are expiring within a given number of days.',
    params: [DAYS_PARAM],
  },
  {
    name: 'branch_sales',
    description: 'Which branches generated the most flight sales.',
    params: [DAYS_PARAM, LIMIT_PARAM],
  },
  {
    name: 'cancelled_bookings_count',
    description: 'How many flight bookings were cancelled over a period.',
    params: [DAYS_PARAM],
  },
];

export function findQuerySpec(name: string): AnalyticsQuerySpec | undefined {
  return ANALYTICS_QUERY_REGISTRY.find((q) => q.name === name);
}

/** Clamps/defaults every declared param, and drops anything the caller
 * (or the AI's JSON) sent that isn't a declared param for this query —
 * belt-and-braces alongside the query-name allowlist itself. */
export function coerceParams(
  spec: AnalyticsQuerySpec,
  raw: Record<string, unknown> | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const paramSpec of spec.params) {
    const value = raw?.[paramSpec.name];
    const numeric =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : paramSpec.default;
    result[paramSpec.name] = Math.min(
      paramSpec.max,
      Math.max(paramSpec.min, Math.round(numeric)),
    );
  }
  return result;
}

export function buildRegistryPrompt(): string {
  return ANALYTICS_QUERY_REGISTRY.map((q) => {
    const paramsText =
      q.params.length === 0
        ? 'no parameters'
        : q.params
            .map((p) => `${p.name} (${p.description}, default ${p.default})`)
            .join(', ');
    return `- ${q.name}: ${q.description} Parameters: ${paramsText}.`;
  }).join('\n');
}
