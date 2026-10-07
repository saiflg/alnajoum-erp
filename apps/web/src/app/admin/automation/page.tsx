'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PageHeader } from '@/components/portal/PageHeader';
import { ExecutionTrace, StatusPill } from '@/components/workflows/ExecutionTrace';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { errorText, useApi } from '@/lib/use-api';
import type { AutomationMetrics, DeadLetterRow, EventRow, ExecutionDetail, ExecutionRow } from '@/lib/workflow-types';

type Tab = 'overview' | 'executions' | 'failed' | 'events';
const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200';
const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40';

function Tile({ label, value, tone = 'slate', hint }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'rose' | 'amber' | 'sky'; hint?: string }) {
  const tones = { slate: 'text-slate-900', emerald: 'text-emerald-700', rose: 'text-rose-700', amber: 'text-amber-700', sky: 'text-sky-700' };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
const pct = (v: number | null) => (v === null ? 'No runs yet' : `${v}%`);

export default function AutomationCentrePage() {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const canRetry = perms.includes('workflow:retry_execution');
  const canCancel = perms.includes('workflow:cancel_execution');

  const [tab, setTab] = useState<Tab>('overview');
  const [rev, setRev] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Refresh every 30 seconds so the centre stays current without anyone pressing a button.
  useEffect(() => {
    const t = setInterval(() => setRev((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const execQs = new URLSearchParams();
  if (status) execQs.set('status', status);
  if (search.trim()) execQs.set('search', search.trim());
  const metrics = useApi<AutomationMetrics>(tab === 'overview' ? '/automation/metrics' : null, rev);
  const executions = useApi<{ total: number; items: ExecutionRow[] }>(tab === 'executions' ? `/automation/executions?${execQs.toString()}` : null, rev);
  const deadLetters = useApi<DeadLetterRow[]>(tab === 'failed' ? '/automation/dead-letters?status=OPEN' : null, rev);
  const events = useApi<EventRow[]>(tab === 'events' ? '/automation/events?limit=60' : null, rev);
  const detail = useApi<ExecutionDetail>(openId ? `/automation/executions/${openId}` : null, rev);

  async function act(key: string, path: string, body: unknown, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await apiRequest(path, { method: 'POST', body });
      setMessage({ tone: 'ok', text: ok });
      setRev((n) => n + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }
  const askReason = (what: string): string | null => {
    const r = window.prompt(`${what} — please give a reason (at least 5 characters)`);
    return r && r.trim().length >= 5 ? r.trim() : null;
  };

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Automation centre" navLinks={ADMIN_NAV}>
        <PageHeader scene="sky" title="Automation centre" subtitle="What is running, what failed, and the controls to put it right. Nothing that fails is discarded — it waits here for a person.">
          <div className="flex gap-1 rounded-xl bg-white/10 p-1 backdrop-blur" role="tablist" aria-label="Automation sections">
            {([['overview', 'Overview'], ['executions', 'Runs'], ['failed', 'Needs attention'], ['events', 'Events']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setOpenId(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-white text-slate-900' : 'text-white/80 hover:bg-white/10'}`}>{label}</button>
            ))}
          </div>
        </PageHeader>

        {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-sm ${message.tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}

        {tab === 'overview' && (
          <>
            {metrics.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{metrics.error}</p>}
            {metrics.loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
            {metrics.data && (() => {
              const m = metrics.data;
              const n = (r: Record<string, number>, k: string) => r[k] ?? 0;
              return (
                <>
                  <p className="mb-3 text-xs text-slate-500">As of {formatDateTime(m.generatedAt)} · live runs only (test runs are not counted)</p>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Tile label="Active workflows" value={m.workflows.ACTIVE ?? 0} tone="emerald" hint={`${m.workflows.PAUSED ?? 0} paused · ${m.workflows.DRAFT ?? 0} draft`} />
                    <Tile label="Runs, last 24 h" value={Object.values(m.executions.last24h).reduce((a, b) => a + b, 0)} hint={`${n(m.executions.last24h, 'COMPLETED')} completed · ${n(m.executions.last24h, 'WAITING')} waiting`} />
                    <Tile label="Success rate (24 h)" value={pct(m.successRatePercent.last24h)} tone={m.successRatePercent.last24h !== null && m.successRatePercent.last24h < 90 ? 'rose' : 'emerald'} hint={`7 days: ${pct(m.successRatePercent.last7d)}`} />
                    <Tile label="Failure rate (24 h)" value={pct(m.failureRatePercent.last24h)} tone={(m.failureRatePercent.last24h ?? 0) > 10 ? 'rose' : 'slate'} hint={`7 days: ${pct(m.failureRatePercent.last7d)}`} />
                    <Tile label="Needs attention" value={m.deadLettersOpen} tone={m.deadLettersOpen > 0 ? 'rose' : 'emerald'} hint="Failed runs waiting for a person" />
                    <Tile label="Due now (queue depth)" value={m.queue.dueNow} tone={m.queue.dueNow > 20 ? 'amber' : 'slate'} hint="Runs ready to be picked up" />
                    <Tile label="Events not yet handled" value={m.queue.eventsPending + m.queue.eventsFailed} tone={m.queue.eventsFailed > 0 ? 'amber' : 'slate'} hint={`${m.queue.eventsPending} pending · ${m.queue.eventsFailed} failed`} />
                    <Tile label="Average run time" value={m.avgCompletionSeconds === null ? '—' : `${m.avgCompletionSeconds}s`} hint="Completed runs, last 7 days" />
                  </div>
                  {m.topFailingWorkflows.length > 0 && <p className="mt-4 text-xs text-slate-600">Most failures this week: {m.topFailingWorkflows.map((t) => <Link key={t.workflowId} href={`/admin/workflows/${t.workflowId}`} className="mx-1 rounded bg-rose-50 px-1.5 py-0.5 font-mono text-rose-700 hover:underline">{t.workflowId.slice(0, 8)}… ({t.deadLetters})</Link>)}</p>}
                </>
              );
            })()}
          </>
        )}

        {tab === 'executions' && (
          <>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-600">Status
                <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>{['RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="min-w-64 flex-1 text-xs font-medium text-slate-600">Search by run id, booking / customer / payment / ticket id, correlation id or workflow name
                <input className={field} value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
            {executions.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{executions.error}</p>}
            {executions.loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
            {executions.data && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Workflow</th><th>Status</th><th>Mode</th><th>Record</th><th>Started</th><th /></tr></thead>
                  <tbody>
                    {executions.data.items.map((x) => (
                      <tr key={x.id} className={`border-t border-slate-100 ${openId === x.id ? 'bg-sky-50/50' : ''}`}>
                        <td className="px-3 py-2 font-medium text-slate-900">{x.workflow.name} <span className="text-slate-400">v{x.versionNo}</span></td>
                        <td><StatusPill status={x.status} /></td>
                        <td>{x.mode}</td>
                        <td className="font-mono">{x.entityType ? `${x.entityType} ${x.entityId?.slice(0, 10) ?? ''}` : '—'}</td>
                        <td>{formatDateTime(x.startedAt)}</td>
                        <td className="pr-3 text-right"><button type="button" className="text-sky-700 hover:underline" onClick={() => setOpenId(openId === x.id ? null : x.id)}>{openId === x.id ? 'Hide' : 'Trace'}</button></td>
                      </tr>
                    ))}
                    {executions.data.items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No runs match.</td></tr>}
                  </tbody>
                </table>
                <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{executions.data.total} run{executions.data.total === 1 ? '' : 's'} match · showing the latest {executions.data.items.length}</p>
              </div>
            )}
          </>
        )}

        {tab === 'failed' && (
          <>
            {deadLetters.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{deadLetters.error}</p>}
            {deadLetters.loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
            {deadLetters.data?.length === 0 && <p className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-8 text-center text-sm text-emerald-800">Nothing needs attention. Failed runs appear here instead of being lost.</p>}
            <ul className="space-y-3">
              {(deadLetters.data ?? []).map((d) => (
                <li key={d.id} className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{d.execution.workflow.name}</p>
                      <p className="mt-0.5 text-xs text-rose-800"><span className="font-mono">{d.reason}</span>{d.nodeId ? ` at step “${d.nodeId}”` : ''}</p>
                      {d.error && <p className="mt-1 max-w-3xl text-xs text-slate-600">{d.error}</p>}
                      <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(d.createdAt)} · {d.retryCount} retr{d.retryCount === 1 ? 'y' : 'ies'} · correlation <span className="font-mono">{d.correlationId.slice(0, 8)}…</span></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={`${btn} border border-slate-300 hover:bg-slate-50`} onClick={() => { setTab('executions'); setSearch(d.executionId); setOpenId(d.executionId); }}>Inspect</button>
                      {canRetry && <button type="button" disabled={busy !== null} className={`${btn} bg-slate-900 text-white hover:bg-slate-800`} onClick={() => { const financial = window.confirm('Retry this step now? (If it moves money, confirm you have checked it did not already complete.)'); if (financial) void act(`r${d.id}`, `/automation/dead-letters/${d.id}/retry`, { confirmFinancial: true }, 'Retried — see the run for the result.'); }}>Retry</button>}
                      {canRetry && <button type="button" disabled={busy !== null} className={`${btn} border border-emerald-300 text-emerald-800 hover:bg-emerald-50`} onClick={() => { const note = askReason('Mark as resolved'); if (note) void act(`s${d.id}`, `/automation/dead-letters/${d.id}/resolve`, { note }, 'Marked as resolved.'); }}>Resolve</button>}
                      {canCancel && <button type="button" disabled={busy !== null} className={`${btn} text-rose-700 hover:bg-rose-50`} onClick={() => { const reason = askReason('Cancel this run'); if (reason) void act(`c${d.id}`, `/automation/dead-letters/${d.id}/cancel`, { reason }, 'Cancelled.'); }}>Cancel run</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'events' && (
          <>
            {events.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{events.error}</p>}
            {events.loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
            {events.data && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Event</th><th>From</th><th>Record</th><th>Handled</th><th>When</th></tr></thead>
                  <tbody>{events.data.map((e) => <tr key={e.id} className="border-t border-slate-100"><td className="px-3 py-2 font-mono text-slate-900">{e.type}</td><td>{e.source}</td><td className="font-mono">{e.entityType ? `${e.entityType} ${e.entityId?.slice(0, 10) ?? ''}` : '—'}</td><td className={e.status === 'FAILED' ? 'text-rose-700' : e.status === 'PENDING' ? 'text-amber-700' : 'text-emerald-700'}>{e.status}{e.error ? ` — ${e.error}` : ''}</td><td>{formatDateTime(e.occurredAt)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}

        {openId && (
          <section className="mt-4 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm" aria-label="Run trace">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">Run trace {detail.data && <StatusPill status={detail.data.status} />}</h3>
              <div className="flex gap-2">
                {canCancel && detail.data && ['RUNNING', 'WAITING'].includes(detail.data.status) && <button type="button" disabled={busy !== null} className={`${btn} text-rose-700 hover:bg-rose-50`} onClick={() => { const reason = askReason('Cancel this run'); if (reason) void act(`x${openId}`, `/automation/executions/${openId}/cancel`, { reason }, 'Run cancelled.'); }}>Cancel run</button>}
                <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpenId(null)}>Close</button>
              </div>
            </div>
            {detail.loading && <div className="mt-3 h-24 animate-pulse rounded-xl bg-slate-100" />}
            {detail.error && <p role="alert" className="mt-2 text-sm text-rose-700">{detail.error}</p>}
            {detail.data && <div className="mt-3"><ExecutionTrace execution={detail.data} /></div>}
          </section>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
