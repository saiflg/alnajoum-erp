'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { starterGraph } from '@/components/workflows/graph-utils';
import { PageHeader } from '@/components/portal/PageHeader';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { errorText, useApi } from '@/lib/use-api';
import type { Catalog, WorkflowStatus, WorkflowSummary } from '@/lib/workflow-types';

const STATUS_STYLE: Record<WorkflowStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  TESTING: 'bg-violet-100 text-violet-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PAUSED: 'bg-amber-100 text-amber-800',
  DISABLED: 'bg-slate-200 text-slate-600',
  ARCHIVED: 'bg-slate-100 text-slate-400',
};

const FILTERS: (WorkflowStatus | '')[] = ['', 'ACTIVE', 'TESTING', 'DRAFT', 'PAUSED', 'DISABLED', 'ARCHIVED'];
const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200';

export default function WorkflowsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canCreate = user?.permissions.includes('workflow:create') ?? false;
  const [status, setStatus] = useState<WorkflowStatus | ''>('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [event, setEvent] = useState('flight.ticket_issued');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search.trim()) qs.set('search', search.trim());
  const list = useApi<WorkflowSummary[]>(`/workflows${qs.toString() ? `?${qs.toString()}` : ''}`, refresh);
  const catalog = useApi<Catalog>('/automation/catalog');

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await apiRequest<{ id: string }>('/workflows', { method: 'POST', body: { name: name.trim(), description: description.trim() || undefined, graph: starterGraph(event) } });
      setRefresh((n) => n + 1);
      router.push(`/admin/workflows/${created.id}`);
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Workflows" navLinks={ADMIN_NAV}>
        <PageHeader scene="globe" title="Workflow automation" subtitle="Build step-by-step processes that react to what happens in the business. Nothing runs until a person tests, validates and activates it — and every step is recorded.">
          <div className="flex gap-2">
            <Link href="/admin/automation" className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20">Automation centre</Link>
            {canCreate && <button type="button" onClick={() => setCreating((v) => !v)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100">{creating ? 'Close' : 'New workflow'}</button>}
          </div>
        </PageHeader>

        {creating && (
          <form onSubmit={create} className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">Name<input required minLength={3} maxLength={120} className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block text-xs font-medium text-slate-600">Starts when
              <select className={field} value={event} onChange={(e) => setEvent(e.target.value)}>
                {(catalog.data?.triggers ?? []).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">Prefer a schedule? Pick any event and switch the trigger to “On a schedule” in the builder.</span>
            </label>
            <label className="block text-xs font-medium text-slate-600 sm:col-span-2">Description (optional)<input maxLength={1000} className={field} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            {formError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{formError}</p>}
            <div className="sm:col-span-2"><button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{busy ? 'Creating…' : 'Create and open builder'}</button></div>
          </form>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">Status
            <select className={field} value={status} onChange={(e) => setStatus(e.target.value as WorkflowStatus | '')}>{FILTERS.map((f) => <option key={f} value={f}>{f || 'All'}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-slate-600">Search<input className={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Workflow name" /></label>
        </div>

        {list.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{list.error}</p>}
        {list.loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
        {list.data && list.data.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No workflows yet.</p>}

        <ul className="grid gap-3 md:grid-cols-2">
          {(list.data ?? []).map((w) => (
            <li key={w.id}>
              <Link href={`/admin/workflows/${w.id}`} className="block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{w.name}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[w.status]}`}>{w.status}</span>
                </div>
                {w.description && <p className="mt-1 text-xs text-slate-600">{w.description}</p>}
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span>Trigger: <span className="font-mono">{w.triggerEvent ?? 'not activated yet'}</span></span>
                  <span>Version {w.latestVersion}</span>
                  <span>{w._count.executions} runs</span>
                  <span>Updated {formatDateTime(w.updatedAt)}</span>
                </p>
                {w.isDemo && <p className="mt-2 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">DEMO — review before activating</p>}
              </Link>
            </li>
          ))}
        </ul>

        {catalog.data && catalog.data.unavailableTriggers.length > 0 && (
          <details className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Triggers that cannot be used yet ({catalog.data.unavailableTriggers.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">{catalog.data.unavailableTriggers.map((u) => <li key={u.type}><span className="font-mono">{u.type}</span> — {u.reason}</li>)}</ul>
          </details>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
