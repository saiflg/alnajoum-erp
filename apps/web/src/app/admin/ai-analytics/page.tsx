'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

interface AskAnalyticsResult {
  matched: boolean;
  query?: string;
  params?: Record<string, number>;
  summary: string;
  data?: Record<string, unknown>;
  provider: string;
}

interface AiUsageRow {
  id: string;
  question: string;
  matchedQuery: string | null;
  status: 'MATCHED' | 'UNMATCHED' | 'ERROR';
  provider: string;
  createdAt: string;
  identity?: { email: string } | null;
}

const EXAMPLE_QUESTIONS = [
  'What were total ticket sales this month?',
  'Which routes generated the most revenue?',
  'How much is currently owed to suppliers?',
  'How much incentive is pending?',
  'Which visas are approaching expiry?',
  'Which branches generated the most sales?',
  'How many bookings were cancelled?',
];

/** Renders result.data generically: an array of small objects becomes a
 * table, everything else becomes a key/value list — deliberately generic
 * rather than one hand-built view per query, since the registry (and this
 * page) is meant to grow. */
function DataView({ data }: { data: Record<string, unknown> }) {
  const arrayEntry = Object.entries(data).find(
    ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object',
  );

  if (arrayEntry) {
    const [key, rows] = arrayEntry as [string, Record<string, unknown>[]];
    const columns = Object.keys(rows[0]);
    return (
      <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-3 py-1.5 text-left font-medium text-slate-600">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={`${key}-${i}`}>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-1.5 text-slate-700">
                    {typeof row[c] === 'number'
                      ? (row[c] as number).toLocaleString()
                      : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const scalarEntries = Object.entries(data).filter(([, v]) => typeof v !== 'object');
  if (scalarEntries.length === 0) return null;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      {scalarEntries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs text-slate-400">{key}</dt>
          <dd className="text-slate-800">
            {typeof value === 'number' ? value.toLocaleString() : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Phase 13 spec #7/#8/#31 — natural-language business analytics. Every
 * question goes through AiAnalyticsService's allowlisted query registry
 * server-side; this page just asks the question and renders whatever
 * comes back, honestly showing "I couldn't match that" when nothing did
 * rather than pretending an answer exists.
 */
export default function AiAnalyticsPage() {
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskAnalyticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const navLinks =
    user?.roles.includes('FINANCE_OFFICER') && user.roles.length === 1
      ? FINANCE_NAV
      : ADMIN_NAV;
  const canViewUsage = user?.permissions.includes('ai:usage_view') ?? false;

  async function ask(q: string) {
    setError(null);
    setResult(null);
    setAsking(true);
    try {
      const res = await apiRequest<AskAnalyticsResult>('/ai/analytics/ask', {
        method: 'POST',
        body: { question: q },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to get an answer');
    } finally {
      setAsking(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) return;
    void ask(question);
  }

  return (
    <ProtectedRoute
      allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER']}
    >
      <AppShell title="AI Analytics" navLinks={navLinks}>
        <h2 className="text-lg font-semibold text-slate-900">AI Analytics Assistant</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Ask a business question in plain English. Every number comes straight from a
          real, tenant-scoped database query — the assistant only picks which report to
          run, it never invents a figure. If it doesn&apos;t recognize the question, it
          says so instead of guessing.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What were total ticket sales this month?"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={asking || question.trim().length < 3}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                void ask(q);
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {result && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-slate-900">{result.summary}</p>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {result.provider}
              </span>
            </div>
            {result.matched && result.data && <DataView data={result.data} />}
          </div>
        )}

        {canViewUsage && <UsageSection />}
      </AppShell>
    </ProtectedRoute>
  );
}

/** Phase 13 spec #40 — lets an administrator review AI usage. */
function UsageSection() {
  const [rows, setRows] = useState<AiUsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<AiUsageRow[]>('/ai/usage')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-slate-900">Recent AI Usage</h3>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">When</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Asked by</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Question</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Matched</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {formatDateTime(r.createdAt)}
                </td>
                <td className="px-4 py-2 text-slate-600">{r.identity?.email ?? '—'}</td>
                <td className="px-4 py-2 text-slate-700">{r.question}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">
                  {r.matchedQuery ?? '—'}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.status === 'MATCHED'
                        ? 'bg-green-100 text-green-700'
                        : r.status === 'ERROR'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                  No AI requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
