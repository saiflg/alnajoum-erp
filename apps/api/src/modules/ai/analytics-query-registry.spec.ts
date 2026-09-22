import {
  ANALYTICS_QUERY_REGISTRY,
  buildRegistryPrompt,
  coerceParams,
  findQuerySpec,
} from './analytics-query-registry';

describe('analytics-query-registry', () => {
  describe('findQuerySpec', () => {
    it('finds a known query by name', () => {
      expect(findQuerySpec('total_ticket_sales')?.name).toBe(
        'total_ticket_sales',
      );
    });

    it('returns undefined for an unknown name — the allowlist boundary', () => {
      expect(findQuerySpec('drop_table_users')).toBeUndefined();
    });
  });

  describe('coerceParams', () => {
    const spec = findQuerySpec('top_routes_by_revenue')!;

    it('fills in defaults when nothing is provided', () => {
      expect(coerceParams(spec, undefined)).toEqual({ days: 30, limit: 5 });
    });

    it('accepts a valid value within range', () => {
      expect(coerceParams(spec, { days: 7, limit: 3 })).toEqual({
        days: 7,
        limit: 3,
      });
    });

    it('clamps a value above the max', () => {
      expect(coerceParams(spec, { days: 9999, limit: 999 })).toEqual({
        days: 365,
        limit: 20,
      });
    });

    it('clamps a value below the min', () => {
      expect(coerceParams(spec, { days: -5, limit: 0 })).toEqual({
        days: 1,
        limit: 1,
      });
    });

    it('falls back to default for a non-numeric value — never lets a string through', () => {
      expect(coerceParams(spec, { days: 'DROP TABLE users' })).toEqual(
        expect.objectContaining({ days: 30 }),
      );
    });

    it('drops any param not declared for this query, even if present in the raw object', () => {
      const noParamSpec = findQuerySpec('supplier_liabilities')!;
      expect(coerceParams(noParamSpec, { days: 30 })).toEqual({});
    });
  });

  describe('buildRegistryPrompt', () => {
    it('lists every registered query name', () => {
      const prompt = buildRegistryPrompt();
      for (const q of ANALYTICS_QUERY_REGISTRY) {
        expect(prompt).toContain(q.name);
      }
    });
  });
});
