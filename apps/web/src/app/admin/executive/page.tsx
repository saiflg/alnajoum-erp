'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import type { NavLink } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AgeingBar } from '@/components/analytics/AgeingBar';
import { KpiCard, formatMetric } from '@/components/analytics/KpiCard';
import { TrendChart } from '@/components/analytics/TrendChart';
import { PageHeader } from '@/components/portal/PageHeader';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type {
  BranchesResponse,
  DataQualityReport,
  DefinitionsResponse,
  OverviewResponse,
  TrendResponse,
} from '@/lib/analytics-types';

const PRESETS = [
  ['TODAY', 'Today'],
  ['YESTERDAY', 'Yesterday'],
  ['THIS_WEEK', 'This week'],
  ['THIS_MONTH', 'This month'],
  ['PREVIOUS_MONTH', 'Last month'],
  ['THIS_QUARTER', 'This quarter'],
  ['THIS_YEAR', 'This year'],
  ['CUSTOM', 'Custom range'],
] as const;

const COMPARISONS = [
  ['PREVIOUS_PERIOD', 'Previous period'],
  ['PREVIOUS_MONTH', 'Same days last month'],
  ['PREVIOUS_QUARTER', 'Same days last quarter'],
  ['PREVIOUS_YEAR', 'Same days last year'],
  ['NONE', 'No comparison'],
] as const;

const TREND_METRICS = [
  ['booked_value', 'Booked value', '#0ea5e9'],
  ['bookings_count', 'Bookings', '#8b5cf6'],
  ['cash_collected', 'Cash collected', '#10b981'],
] as const;

type Tab = 'overview' | 'quality' | 'definitions';
type Loaded<T> = { key: string; data?: T; error?: string };

/** Fetch keyed by `key`: "loading" is simply "the stored result is for a different key", so no state is set synchronously in an effect. */
function useApi<T>(path: string | null): { data?: T; error?: string; loading: boolean } {
  const [result, setResult] = useState<Loaded<T> | null>(null);
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    apiRequest<T>(path)
      .then((data) => !cancelled && setResult({ key: path, data }))
      .catch((err) => !cancelled && setResult({ key: path, error: err instanceof ApiError ? err.message : 'Request failed' }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  const current = result && result.key === path ? result : null;
  return { data: current?.data, error: current?.error, loading: path !== null && current === null };
}

const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200';

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const nav: NavLink[] = roles.includes('FINANCE_OFFICER') && !roles.some((r) => ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r))
    ? FINANCE_NAV
    : roles.includes('BRANCH_MANAGER') && !roles.some((r) => ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r))
      ? [
          { href: '/branch/dashboard', label: 'Dashboard' },
          { href: '/admin/executive', label: 'Executive Analytics' },
        ]
      : ADMIN_NAV;

  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<(typeof PRESETS)[number][0]>('THIS_MONTH');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [comparison, setComparison] = useState<(typeof COMPARISONS)[number][0]>('PREVIOUS_PERIOD');
  const [branchId, setBranchId] = useState('');
  const [trendMetric, setTrendMetric] = useState<(typeof TREND_METRICS)[number][0]>('booked_value');

  // A custom range is only sent once both dates are filled in.
  const periodQs = useMemo(() => {
    if (preset === 'CUSTOM' && (!from || !to)) return null;
    const p = new URLSearchParams({ preset });
    if (preset === 'CUSTOM') {
      p.set('from', from);
      p.set('to', to);
    }
    if (branchId) p.set('branchId', branchId);
    return p;
  }, [preset, from, to, branchId]);

  const overviewPath = periodQs && tab === 'overview' ? `/analytics/overview?${new URLSearchParams({ ...Object.fromEntries(periodQs), comparison }).toString()}` : null;
  const trendPath = periodQs && tab === 'overview' ? `/analytics/trend?${new URLSearchParams({ ...Object.fromEntries(periodQs), metric: trendMetric }).toString()}` : null;
  const branchesPath = periodQs && tab === 'overview' ? `/analytics/branches?${new URLSearchParams(Object.fromEntries([...periodQs].filter(([k]) => k !== 'branchId'))).toString()}` : null;

  const overview = useApi<OverviewResponse>(overviewPath);
  const trend = useApi<TrendResponse>(trendPath);
  const branches = useApi<BranchesResponse>(branchesPath);
  const quality = useApi<DataQualityReport>(tab === 'quality' ? `/analytics/data-quality${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}` : null);
  const defs = useApi<DefinitionsResponse>(tab === 'definitions' ? '/analytics/metrics' : null);

  const meta = overview.data?.meta;
  const currency = meta?.currency ?? 'NGN';
  const branchLocked = meta?.scope.branchLocked ?? false;
  const trendTone = TREND_METRICS.find((t) => t[0] === trendMetric)?.[2] ?? '#0ea5e9';
  const financeMetrics = overview.data?.metrics.filter((m) => m.details?.ageing) ?? [];
  const canSeeFinance = overview.data?.metrics.some((m) => m.key === 'cash_collected') ?? false;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER', 'BRANCH_MANAGER', 'AUDITOR', 'REPORT_VIEWER']}>
      <AppShell title="Executive Analytics" navLinks={nav}>
        <PageHeader scene="globe" title="Executive analytics" subtitle="One definition per number. Live from your own records, scoped to your company — and clear about what it cannot tell you.">
          <div className="flex gap-1 rounded-xl bg-white/10 p-1 backdrop-blur" role="tablist" aria-label="Analytics sections">
            {([['overview', 'Overview'], ['quality', 'Data quality'], ['definitions', 'Definitions']] as const)
              .filter(([id]) => id === 'overview' || permissions.includes(id === 'quality' ? 'analytics:data_quality_view' : 'analytics:definitions_view'))
              .map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${tab === id ? 'bg-white text-slate-900' : 'text-white/80 hover:bg-white/10'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </PageHeader>

        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
              <label className="text-xs font-medium text-slate-500">
                Period
                <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className={field}>
                  {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              {preset === 'CUSTOM' && (
                <>
                  <label className="text-xs font-medium text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
                  <label className="text-xs font-medium text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
                </>
              )}
              <label className="text-xs font-medium text-slate-500">
                Compare with
                <select value={comparison} onChange={(e) => setComparison(e.target.value as typeof comparison)} className={field}>
                  {COMPARISONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Branch
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={branchLocked} className={`${field} disabled:bg-slate-100`}>
                  <option value="">{branchLocked ? 'Your branch' : 'Whole company'}</option>
                  {!branchLocked && (branches.data?.branches ?? []).filter((b) => b.branchId).map((b) => <option key={b.branchId} value={b.branchId as string}>{b.name}</option>)}
                </select>
              </label>
            </div>

            {periodQs === null && <p className="mt-4 text-sm text-slate-500">Choose both dates for a custom range.</p>}
            {overview.error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{overview.error}</p>}

            {meta && (
              <div className="mt-4 space-y-2">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700" title={meta.freshnessNote}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                  </span>
                  <span>As of {formatDateTime(meta.generatedAt)}</span>
                  <span>·</span>
                  <span>{meta.range.label}{meta.range.inProgress ? ' (in progress)' : ''}</span>
                  <span>·</span>
                  <span>{meta.scope.description}</span>
                  <span>·</span>
                  <span>{currency}</span>
                  {meta.comparison && (<><span>·</span><span>vs {meta.comparison.label}</span></>)}
                </p>
                {meta.warnings.map((w) => (
                  <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
                ))}
              </div>
            )}

            {overview.loading && <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)}</div>}

            {overview.data && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {overview.data.metrics.filter((m) => !m.details?.ageing).map((m, i) => <KpiCard key={m.key} metric={m} currency={currency} index={i} />)}
              </div>
            )}

            {overview.data && (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Trend</h3>
                  <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                    {TREND_METRICS.filter(([id]) => id !== 'cash_collected' || canSeeFinance).map(([id, label]) => (
                      <button key={id} onClick={() => setTrendMetric(id)} aria-pressed={trendMetric === id} className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${trendMetric === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 min-h-[240px]">
                  {trend.loading && <div className="h-[240px] animate-pulse rounded-xl bg-slate-100" />}
                  {trend.error && <p className="text-sm text-rose-600">{trend.error}</p>}
                  {trend.data?.status === 'UNAVAILABLE' && <p className="py-10 text-center text-sm text-slate-500">{trend.data.unavailableReason}</p>}
                  {trend.data?.status === 'OK' && (
                    <TrendChart
                      key={`${trendMetric}-${trend.data.meta.granularity}-${trend.data.points.length}`}
                      points={trend.data.points}
                      granularity={trend.data.meta.granularity}
                      tone={trendTone}
                      format={(n) => formatMetric(n, trend.data!.meta.unit, trend.data!.meta.currency)}
                    />
                  )}
                </div>
                {trend.data?.status === 'OK' && <p className="mt-1 text-[11px] text-slate-400">One point per {trend.data.meta.granularity}; periods with no activity show as zero.</p>}
              </section>
            )}

            {financeMetrics.length > 0 && (
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {financeMetrics.map((m) => (
                  <AgeingBar
                    key={m.key}
                    title={m.name}
                    caption={m.key === 'receivables_outstanding' ? 'Outstanding now, aged by days since the invoice was issued (invoices have no due date).' : 'Owed to suppliers now, aged by days past the due date.'}
                    rows={m.details?.ageing ?? []}
                    currency={currency}
                  />
                ))}
              </div>
            )}

            {(branches.data?.branches.length ?? 0) > 1 && !branchLocked && (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Booked value by branch</h3>
                <ul className="mt-3 space-y-3">
                  {(() => {
                    const rows = branches.data?.branches ?? [];
                    const max = Math.max(...rows.map((r) => r.bookedValue), 1);
                    return rows.map((r) => (
                      <li key={r.branchId ?? 'none'}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className={r.branchId ? 'font-medium text-slate-700' : 'italic text-slate-500'}>{r.name}</span>
                          <span className="tabular-nums text-slate-600">{formatCurrency(r.bookedValue, currency)} · {r.bookings} bookings</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 transition-all duration-700" style={{ width: `${(r.bookedValue / max) * 100}%` }} />
                        </div>
                      </li>
                    ));
                  })()}
                </ul>
              </section>
            )}

            {overview.data && overview.data.unavailable.length > 0 && (
              <details className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-5">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">What this dashboard cannot tell you yet ({overview.data.unavailable.length})</summary>
                <p className="mt-2 text-xs text-slate-500">These need data the system does not collect. They are listed rather than estimated — no forecast or guess is ever shown as a fact.</p>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {overview.data.unavailable.map((u) => (
                    <li key={u.key} className="rounded-xl bg-white p-3 text-xs shadow-sm">
                      <p className="font-semibold text-slate-800">{u.name}</p>
                      <p className="mt-1 text-slate-600">{u.reason}</p>
                      <p className="mt-1 text-slate-400">To enable: {u.whatWouldFixIt}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {tab === 'quality' && (
          <div className="space-y-4">
            {quality.loading && <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}
            {quality.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{quality.error}</p>}
            {quality.data && (
              <>
                <div className={`rounded-2xl border p-4 ${quality.data.status === 'CLEAN' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <p className="text-sm font-semibold">{quality.data.status === 'CLEAN' ? 'No data-quality problems found.' : `${quality.data.summary.errors} error(s), ${quality.data.summary.warnings} warning(s), ${quality.data.summary.info} note(s)`}</p>
                  <p className="mt-1 text-xs opacity-80">{quality.data.scope} · checked {formatDateTime(quality.data.generatedAt)} · {quality.data.notes.join(' ')}</p>
                </div>
                <ul className="grid gap-3 md:grid-cols-2">
                  {quality.data.checks.map((c) => {
                    const bad = c.count > 0;
                    const tone = !bad ? 'border-slate-200' : c.severity === 'ERROR' ? 'border-rose-300' : c.severity === 'WARNING' ? 'border-amber-300' : 'border-sky-200';
                    return (
                      <li key={c.key} className={`rounded-2xl border bg-white p-4 shadow-sm ${tone}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">{c.title}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${!bad ? 'bg-emerald-50 text-emerald-700' : c.severity === 'ERROR' ? 'bg-rose-50 text-rose-700' : c.severity === 'WARNING' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>{bad ? c.count : 'OK'}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{c.description}</p>
                        {bad && <p className="mt-2 text-[11px] text-slate-500">Affects: {c.affects.join(', ')}</p>}
                        {c.sampleIds.length > 0 && <p className="mt-1 break-all font-mono text-[10px] text-slate-400">e.g. {c.sampleIds.join(', ')}</p>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === 'definitions' && (
          <div className="space-y-3">
            {defs.loading && <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}
            {defs.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{defs.error}</p>}
            {defs.data && (
              <>
                <p className="text-xs text-slate-500">Definitions version {defs.data.version}. Every figure on the dashboard, in the AI assistant and in exports uses exactly these definitions.</p>
                {defs.data.metrics.map((m) => (
                  <details key={m.key} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm open:shadow-md">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                      <span className="flex gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{m.domain}</span>
                        {m.accuracy === 'APPROXIMATE' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">approximate</span>}
                        {m.audience === 'FINANCE' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">finance</span>}
                      </span>
                    </summary>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-[9rem_1fr]">
                      <dt className="text-slate-500">Means</dt><dd className="text-slate-800">{m.definition}</dd>
                      <dt className="text-slate-500">Calculated as</dt><dd className="text-slate-800">{m.calculation}</dd>
                      <dt className="text-slate-500">Dated by</dt><dd className="text-slate-800">{m.dateBasis}</dd>
                      <dt className="text-slate-500">Source</dt><dd className="font-mono text-slate-700">{m.source}</dd>
                      <dt className="text-slate-500">Branch view</dt><dd className="text-slate-800">{m.branchScopable ? 'Supported' : 'Not available — the source has no branch'}</dd>
                      <dt className="text-slate-500">Caveats</dt>
                      <dd><ul className="list-disc space-y-1 pl-4 text-slate-700">{m.caveats.map((c) => <li key={c}>{c}</li>)}</ul></dd>
                    </dl>
                  </details>
                ))}
              </>
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
