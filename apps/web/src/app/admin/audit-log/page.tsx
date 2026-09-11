'use client';

import { Fragment, FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface AuditLogRow {
  id: string;
  identityId: string | null;
  identity: { email: string; type: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  reason: string | null;
  createdAt: string;
}

interface SearchResult {
  items: AuditLogRow[];
  nextCursor: string | null;
}

/**
 * Phase 11 spec #25/#26/#31 — the single centralized, immutable audit
 * trail every governance action (role changes, security events, settings
 * edits, approval decisions, ...) writes to. "Security events" (spec
 * #31's LOGIN_FAILED/ACCOUNT_LOCKED/2FA_ENABLED/... list) aren't a
 * separate store — they're audit_logs rows whose action starts with
 * "security." (see AuthService), so the quick filter below just presets
 * that prefix rather than duplicating a second search surface.
 */
export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function runSearch(cursor?: string, actionOverride?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const actionValue = actionOverride ?? action;
      if (actionValue) params.set('action', actionValue);
      if (entityType) params.set('entityType', entityType);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      if (cursor) params.set('cursor', cursor);
      const result = await apiRequest<SearchResult>(`/audit-logs/search?${params.toString()}`);
      setRows((prev) => (cursor ? [...prev, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }

  // Initial page load — fetch the latest entries with no filters applied.
  // runSearch reads current filter state via closure; only meant to run once, on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an async fetch-then-setState, not a synchronous render-time update; same pattern as every other page's on-mount data load.
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch();
  }

  function quickSecurityFilter() {
    setAction('security.');
    setEntityType('');
    runSearch(undefined, 'security.');
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Audit Log" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
            <p className="mt-1 text-sm text-slate-500">
              Every governance-relevant action, immutable and searchable.
            </p>
          </div>
          <button
            onClick={quickSecurityFilter}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Security events only
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">Action contains</label>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. security. or role.changed"
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Entity type</label>
            <input
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">When</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Actor</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Action</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Entity</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    key={r.id}
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {r.identity?.email ?? '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.action}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {r.entityType ? `${r.entityType} · ${r.entityId ?? ''}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">{r.ipAddress ?? '—'}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={5} className="bg-slate-50 px-4 py-3">
                        {r.reason && (
                          <p className="text-xs text-slate-600">Reason: {r.reason}</p>
                        )}
                        <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
                          {JSON.stringify(r.metadata, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No matching audit entries. Try Search with broader filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <button
            onClick={() => runSearch(nextCursor)}
            disabled={loading}
            className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
