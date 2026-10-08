'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiDownload, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { errorText, useApi } from '@/lib/use-api';

type Tab = 'overview' | 'incidents' | 'access' | 'breakglass' | 'privacy' | 'retention';

const STAFF_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF'];

const card = 'rounded-lg border border-slate-200 bg-white p-4';
const th = 'px-3 py-2 text-left font-medium text-slate-600';
const td = 'px-3 py-2 text-slate-700';
const btn = 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50';
const btnGhost = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

const STATUS_STYLE: Record<string, string> = {
  PASS: 'bg-emerald-100 text-emerald-800',
  WARN: 'bg-amber-100 text-amber-800',
  FAIL: 'bg-red-100 text-red-800',
  UNKNOWN: 'bg-slate-200 text-slate-700',
};

function Badge({ value }: { value: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[value] ?? 'bg-slate-100 text-slate-700'}`}>
      {value}
    </span>
  );
}

function Msg({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}
    </>
  );
}

/** Runs an action, surfaces its error or a success note, and bumps the refresh counter. */
function useAction(bump: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      bump();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return { act, error, notice };
}

// ---------------------------------------------------------------- overview
interface Overview {
  generatedAt: string;
  events: { action: string; label: string; last24h: number; last7d: number }[];
  incidents: { open: number; openCritical: number };
  accounts: {
    activeStaff: number;
    notSeenIn90Days: number;
    privilegedAccounts: number;
    privilegedWithoutTwoFactor: number;
    privilegedWithoutTwoFactorEmails: string[];
  };
}
interface Control {
  id: string;
  title: string;
  status: string;
  detail: string;
  evidence: string;
}

function OverviewTab() {
  const overview = useApi<Overview>('/security/overview');
  const controls = useApi<Control[]>('/security/controls');
  const o = overview.data;
  return (
    <div className="space-y-6">
      {overview.error && <p className="text-sm text-red-600">{overview.error}</p>}
      {o && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className={card}><p className="text-xs text-slate-500">Open incidents</p><p className="text-2xl font-semibold">{o.incidents.open}</p></div>
            <div className={card}><p className="text-xs text-slate-500">Open critical</p><p className="text-2xl font-semibold">{o.incidents.openCritical}</p></div>
            <div className={card}><p className="text-xs text-slate-500">Privileged accounts without 2FA</p><p className="text-2xl font-semibold">{o.accounts.privilegedWithoutTwoFactor} / {o.accounts.privilegedAccounts}</p></div>
            <div className={card}><p className="text-xs text-slate-500">Staff not seen in 90 days</p><p className="text-2xl font-semibold">{o.accounts.notSeenIn90Days} / {o.accounts.activeStaff}</p></div>
          </div>
          {o.accounts.privilegedWithoutTwoFactorEmails.length > 0 && (
            <p className="text-xs text-amber-700">
              Privileged accounts without two-factor: {o.accounts.privilegedWithoutTwoFactorEmails.join(', ')}
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50"><tr><th className={th}>Security event</th><th className={th}>Last 24 h</th><th className={th}>Last 7 days</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {o.events.map((e) => (
                  <tr key={e.action}><td className={td}>{e.label}</td><td className={td}>{e.last24h}</td><td className={td}>{e.last7d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Control register</h3>
        <p className="mt-1 text-xs text-slate-500">
          Each control is measured from the live system. Anything that cannot be measured from here is shown as UNKNOWN, never as a pass.
        </p>
        {controls.error && <p className="mt-2 text-sm text-red-600">{controls.error}</p>}
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th className={th}>ID</th><th className={th}>Control</th><th className={th}>Status</th><th className={th}>Detail</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {controls.data?.map((c) => (
                <tr key={c.id} title={`Evidence: ${c.evidence}`}>
                  <td className={`${td} font-mono text-xs`}>{c.id}</td>
                  <td className={td}>{c.title}</td>
                  <td className={td}><Badge value={c.status} /></td>
                  <td className={`${td} text-xs text-slate-500`}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- incidents
interface IncidentRow { id: string; title: string; severity: string; status: string; detectedAt: string; personalDataInvolved: boolean }
interface IncidentDetail extends IncidentRow { description: string; notes: { id: string; body: string; createdAt: string }[] }
const NEXT_STATUS: Record<string, string[]> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  CONTAINED: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

function IncidentsTab() {
  const [refresh, setRefresh] = useState(0);
  const list = useApi<IncidentRow[]>('/security/incidents', refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApi<IncidentDetail>(selected ? `/security/incidents/${selected}` : null, refresh);
  const [form, setForm] = useState({ title: '', description: '', severity: 'MEDIUM', personalDataInvolved: false });
  const [note, setNote] = useState('');
  const { act, error } = useAction(() => setRefresh((n) => n + 1));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <form
          className={`${card} space-y-2`}
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await apiRequest('/security/incidents', { method: 'POST', body: form });
              setForm({ title: '', description: '', severity: 'MEDIUM', personalDataInvolved: false });
            });
          }}
        >
          <h3 className="text-sm font-semibold">Report an incident</h3>
          <input className={input} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className={input} rows={3} placeholder="What happened, what is affected (10+ characters)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex items-center gap-3">
            <select className={input} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={form.personalDataInvolved} onChange={(e) => setForm({ ...form, personalDataInvolved: e.target.checked })} />
              Personal data involved
            </label>
          </div>
          <button className={btn} type="submit">Open incident</button>
        </form>
        <Msg error={error} />
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th className={th}>Incident</th><th className={th}>Severity</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data?.map((i) => (
                <tr key={i.id} className={`cursor-pointer hover:bg-slate-50 ${selected === i.id ? 'bg-amber-50' : ''}`} onClick={() => setSelected(i.id)}>
                  <td className={td}>{i.title}<div className="text-xs text-slate-400">{formatDateTime(i.detectedAt)}</div></td>
                  <td className={td}>{i.severity}</td>
                  <td className={td}>{i.status}</td>
                </tr>
              ))}
              {list.data?.length === 0 && <tr><td className={`${td} text-center`} colSpan={3}>No incidents recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className={card}>
        {!selected && <p className="text-sm text-slate-500">Select an incident to see its timeline.</p>}
        {detail.error && <p className="text-sm text-red-600">{detail.error}</p>}
        {detail.data && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{detail.data.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{detail.data.description}</p>
              {detail.data.personalDataInvolved && (
                <p className="mt-1 text-xs font-medium text-red-700">Personal data involved — check your breach-notification duties (see docs/security.md).</p>
              )}
            </div>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
              {detail.data.notes.map((n) => (
                <li key={n.id} className="text-sm"><span className="block text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>{n.body}</li>
              ))}
            </ol>
            {detail.data.status !== 'CLOSED' && (
              <>
                <div className="flex gap-2">
                  <input className={input} placeholder="Add a note, or the reason for a status change" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className={btnGhost} disabled={!note} onClick={() => void act(async () => { await apiRequest(`/security/incidents/${detail.data!.id}/notes`, { method: 'POST', body: { body: note } }); setNote(''); })}>Add note</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(NEXT_STATUS[detail.data.status] ?? []).map((s) => (
                    <button key={s} className={btn} disabled={note.length < 3} onClick={() => void act(async () => { await apiRequest(`/security/incidents/${detail.data!.id}/status`, { method: 'POST', body: { status: s, note } }); setNote(''); })}>
                      Move to {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- access review
interface ReviewRow { id: string; status: string; startedAt: string; completedAt: string | null; _count: { items: number } }
interface ReviewItem { id: string; identityId: string; email: string; staffName: string | null; roles: string[]; lastLoginAt: string | null; twoFactorEnabled: boolean; decision: string; revokedAt: string | null }
interface ReviewDetail extends ReviewRow { items: ReviewItem[] }

function AccessTab() {
  const { user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const list = useApi<ReviewRow[]>('/security/access-reviews', refresh);
  const open = list.data?.find((r) => r.status === 'OPEN');
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = picked ?? open?.id ?? list.data?.[0]?.id ?? null;
  const detail = useApi<ReviewDetail>(activeId ? `/security/access-reviews/${activeId}` : null, refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));

  const pending = detail.data?.items.filter((i) => i.decision === 'PENDING').length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Periodically confirm who still needs access. Accounts marked REVOKE are deactivated and signed out when the review is completed. You cannot decide on your own access — another administrator must.
        </p>
        {!open && <button className={btn} onClick={() => void act(() => apiRequest('/security/access-reviews', { method: 'POST' }), 'Review started')}>Start a review</button>}
        {open && detail.data?.id === open.id && (
          <button className={btn} disabled={pending > 0} onClick={() => void act(() => apiRequest(`/security/access-reviews/${open.id}/complete`, { method: 'POST' }), 'Review completed')}>
            Complete review{pending > 0 ? ` (${pending} undecided)` : ''}
          </button>
        )}
      </div>
      <Msg error={error ?? list.error ?? detail.error} notice={notice} />
      {list.data && list.data.length > 0 && (
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={activeId ?? ''} onChange={(e) => setPicked(e.target.value)}>
          {list.data.map((r) => <option key={r.id} value={r.id}>{formatDateTime(r.startedAt)} — {r.status} ({r._count.items} accounts)</option>)}
        </select>
      )}
      {detail.data && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th className={th}>Account</th><th className={th}>Roles</th><th className={th}>2FA</th><th className={th}>Last sign-in</th><th className={th}>Decision</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {detail.data.items.map((i) => (
                <tr key={i.id}>
                  <td className={td}>{i.staffName ?? i.email}<div className="text-xs text-slate-400">{i.email}</div></td>
                  <td className={td}>{i.roles.join(', ')}</td>
                  <td className={td}>{i.twoFactorEnabled ? 'Yes' : 'No'}</td>
                  <td className={`${td} text-xs`}>{i.lastLoginAt ? formatDateTime(i.lastLoginAt) : 'Never'}</td>
                  <td className={td}>
                    {detail.data!.status === 'OPEN' && i.identityId !== user?.id ? (
                      <div className="flex gap-1">
                        {(['KEEP', 'REVOKE'] as const).map((d) => (
                          <button key={d} className={i.decision === d ? btn : btnGhost} onClick={() => void act(() => apiRequest(`/security/access-reviews/${detail.data!.id}/items/${i.id}/decision`, { method: 'POST', body: { decision: d } }))}>{d}</button>
                        ))}
                      </div>
                    ) : (
                      <span>{i.revokedAt ? 'Revoked' : i.decision}{i.identityId === user?.id ? ' (you — someone else decides)' : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- break glass
interface Grant { id: string; roleName: string; reason: string; status: string; requestedAt: string; durationMinutes: number; expiresAt: string | null; identityId: string }
interface RoleRow { id: string; name: string }

function BreakGlassTab() {
  const { user } = useAuth();
  const isSuper = !!user?.roles.includes('SUPER_ADMIN');
  const [refresh, setRefresh] = useState(0);
  const grants = useApi<Grant[]>('/security/break-glass', refresh);
  const roles = useApi<RoleRow[]>('/rbac/roles');
  const [form, setForm] = useState({ roleId: '', reason: '', minutes: 30 });
  const { act, error } = useAction(() => setRefresh((n) => n + 1));

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        Emergency access to another role: you state why, a Super Admin approves, and the role is removed automatically when the time is up (at most 120 minutes). Super Admin cannot be obtained this way. Everything is audited.
      </p>
      <form
        className={`${card} grid gap-2 sm:grid-cols-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await apiRequest('/security/break-glass', { method: 'POST', body: form });
            setForm({ roleId: '', reason: '', minutes: 30 });
          });
        }}
      >
        <select className={input} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
          <option value="">Role needed…</option>
          {roles.data?.filter((r) => r.name !== 'SUPER_ADMIN' && r.name !== 'CUSTOMER').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input className={`${input} sm:col-span-2`} placeholder="Why is this needed? (10+ characters)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <div className="flex gap-2">
          <input className={input} type="number" min={5} max={120} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} />
          <button className={btn} type="submit" disabled={!form.roleId || form.reason.length < 10}>Request</button>
        </div>
      </form>
      <Msg error={error ?? grants.error} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr><th className={th}>Role</th><th className={th}>Reason</th><th className={th}>Status</th><th className={th}>Expires</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {grants.data?.map((g) => (
              <tr key={g.id}>
                <td className={td}>{g.roleName}<div className="text-xs text-slate-400">{g.durationMinutes} min</div></td>
                <td className={td}>{g.reason}</td>
                <td className={td}>{g.status}</td>
                <td className={`${td} text-xs`}>{g.expiresAt ? formatDateTime(g.expiresAt) : '—'}</td>
                <td className={`${td} text-right`}>
                  <div className="flex justify-end gap-1">
                    {g.status === 'REQUESTED' && isSuper && g.identityId !== user?.id && (
                      <>
                        <button className={btn} onClick={() => void act(() => apiRequest(`/security/break-glass/${g.id}/approve`, { method: 'POST' }))}>Approve</button>
                        <button className={btnGhost} onClick={() => void act(() => apiRequest(`/security/break-glass/${g.id}/deny`, { method: 'POST' }))}>Deny</button>
                      </>
                    )}
                    {(g.status === 'ACTIVE' || g.status === 'REQUESTED') && g.identityId === user?.id && (
                      <button className={btnGhost} onClick={() => void act(() => apiRequest(`/security/break-glass/${g.id}/revoke`, { method: 'POST' }))}>
                        {g.status === 'ACTIVE' ? 'Give back' : 'Withdraw'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {grants.data?.length === 0 && <tr><td className={`${td} text-center`} colSpan={5}>No break-glass requests.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- privacy
interface PrivacyRequest { id: string; customerId: string; type: string; status: string; createdAt: string }
interface ErasureCheck { canErase: boolean; blockers: string[] }

function PrivacyTab() {
  const [refresh, setRefresh] = useState(0);
  const requests = useApi<PrivacyRequest[]>('/security/privacy/requests', refresh);
  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState<ErasureCheck | null>(null);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const id = customerId.trim();
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        Answer a customer&apos;s request for a copy of their data, or to be forgotten. Erasure removes personal details and stored documents but keeps the financial records the law requires, with the person&apos;s details replaced. It cannot be undone. Both actions ask you to confirm your identity.
      </p>
      <div className={`${card} space-y-2`}>
        <input className={input} placeholder="Customer ID" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setCheck(null); }} />
        <input className={input} placeholder="Reason for erasure (10+ characters, e.g. the customer's written request)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} disabled={!id} onClick={() => void act(() => apiDownload(`/security/privacy/customers/${id}/export`, `customer-${id}-export.json`), 'Export downloaded')}>Download data export</button>
          <button className={btnGhost} disabled={!id} onClick={() => void act(async () => setCheck(await apiRequest<ErasureCheck>(`/security/privacy/customers/${id}/erasure-check`)))}>Check erasure</button>
          <button
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
            disabled={!id || reason.length < 10 || !check?.canErase}
            onClick={() => {
              if (confirm('Erase this customer permanently? This cannot be undone.')) {
                void act(() => apiRequest(`/security/privacy/customers/${id}/erase`, { method: 'POST', body: { reason } }), 'Customer erased');
              }
            }}
          >
            Erase customer
          </button>
        </div>
        {check && (check.canErase ? <p className="text-sm text-emerald-700">No blockers — this customer can be erased.</p> : <ul className="list-disc pl-5 text-sm text-red-700">{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>)}
      </div>
      <Msg error={error ?? requests.error} notice={notice} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr><th className={th}>When</th><th className={th}>Request</th><th className={th}>Customer</th><th className={th}>Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {requests.data?.map((r) => <tr key={r.id}><td className={`${td} text-xs`}>{formatDateTime(r.createdAt)}</td><td className={td}>{r.type}</td><td className={`${td} font-mono text-xs`}>{r.customerId}</td><td className={td}>{r.status}</td></tr>)}
            {requests.data?.length === 0 && <tr><td className={`${td} text-center`} colSpan={4}>No requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- retention
interface RetentionRow { key: string; label?: string; retentionDays?: number; eligible?: number; removed?: number }

function RetentionTab() {
  const [refresh, setRefresh] = useState(0);
  const rules = useApi<RetentionRow[]>('/security/retention', refresh);
  const [ran, setRan] = useState<RetentionRow[] | null>(null);
  const { act, error } = useAction(() => setRefresh((n) => n + 1));
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        Platform-wide clean-up of data that has outlived its purpose (expired sign-in tokens, old notifications, processed webhook events). The audit log and financial records are never touched. Running it asks you to confirm your identity.
      </p>
      <button className={btn} onClick={() => void act(async () => setRan(await apiRequest<RetentionRow[]>('/security/retention/run', { method: 'POST' })))}>Run retention now</button>
      <Msg error={error ?? rules.error} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr><th className={th}>Data</th><th className={th}>Kept for</th><th className={th}>Past retention now</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rules.data?.map((r) => <tr key={r.key}><td className={td}>{r.label ?? r.key}</td><td className={td}>{r.retentionDays !== undefined ? `${r.retentionDays} days` : '—'}</td><td className={td}>{r.eligible ?? '—'}</td></tr>)}
          </tbody>
        </table>
      </div>
      {ran && <p className="text-sm text-emerald-700">Removed: {ran.map((r) => `${r.key} ${r.removed ?? 0}`).join(', ')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function SecurityPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.some((r) => r === 'SUPER_ADMIN' || r === 'COMPANY_ADMIN');
  const isSuper = !!user?.roles.includes('SUPER_ADMIN');
  const tabs: { id: Tab; label: string }[] = isAdmin
    ? [
        { id: 'overview', label: 'Overview & controls' },
        { id: 'incidents', label: 'Incidents' },
        { id: 'access', label: 'Access review' },
        { id: 'breakglass', label: 'Break-glass' },
        { id: 'privacy', label: 'Privacy requests' },
        ...(isSuper ? [{ id: 'retention' as Tab, label: 'Retention' }] : []),
      ]
    : [{ id: 'breakglass', label: 'Emergency access' }];
  // The user loads after first render, so the default tab is derived rather than stored.
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked && tabs.some((t) => t.id === picked) ? picked : tabs[0].id;
  const setTab = setPicked;
  const nav = user?.roles.includes('FINANCE_OFFICER') && !isAdmin ? FINANCE_NAV : ADMIN_NAV;

  return (
    <ProtectedRoute allowedRoles={STAFF_ROLES}>
      <AppShell title="Security & Compliance" navLinks={nav}>
        <h2 className="text-lg font-semibold text-slate-900">Security &amp; Compliance</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Live security posture, incident handling, access reviews, emergency access, and privacy requests. This page reports what the system measures; it does not certify compliance with any law or standard.
        </p>
        <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-6">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'incidents' && <IncidentsTab />}
          {tab === 'access' && <AccessTab />}
          {tab === 'breakglass' && <BreakGlassTab />}
          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'retention' && <RetentionTab />}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
