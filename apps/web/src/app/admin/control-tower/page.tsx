'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Badge, Msg, Row, Stat, btn, btnGhost, card, useAction, when } from '@/components/ai/ui';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const STAFF_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER'];
const DOMAIN_LABELS: Record<string, string> = {
  flights: 'Flights', hotels: 'Hotels', visas: 'Visas', pilgrimage: 'Hajj & Umrah', payments: 'Payments', suppliers: 'Suppliers',
  support: 'Customer support', automation: 'Automation failures', security: 'Security',
};

export default function ControlTowerPage() {
  const { user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const tower = useApi<Row>('/ai/control-tower', refresh);
  const { act, error, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const isAdmin = !!user?.roles.some((r) => r === 'SUPER_ADMIN' || r === 'COMPANY_ADMIN');
  const nav = user?.roles.includes('FINANCE_OFFICER') && !isAdmin ? FINANCE_NAV : ADMIN_NAV;
  const t = tower.data;
  return (
    <ProtectedRoute allowedRoles={STAFF_ROLES}>
      <AppShell title="Operations Control Tower" navLinks={nav}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Operations Control Tower</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">What needs attention, most urgent first. Findings come from fixed rules over your records (not a model&apos;s opinion); the order is a visible priority score that weighs how close the deadline is, how many customers and how much money are affected, and the risk.</p>
          </div>
          {isAdmin && <button className={btn} disabled={busy} onClick={() => void act(() => apiRequest('/ai/scan', { method: 'POST', body: {} }), 'Scan complete')}>{busy ? 'Scanning…' : 'Run the scan now'}</button>}
        </div>
        <Msg error={error ?? tower.error} notice={notice} />
        {t && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Critical" value={t.summary.critical} /><Stat label="High" value={t.summary.high} />
              <Stat label="Medium" value={t.summary.medium} /><Stat label="Low" value={t.summary.low} />
              <Stat label="Approvals waiting" value={t.summary.pendingApprovals} /><Stat label="Failed AI runs (24h)" value={t.summary.failedAgentRuns24h} />
              <Stat label="Open security incidents" value={t.summary.openSecurityIncidents} /><Stat label="Customers waiting for a person" value={t.summary.customersWaitingForAPerson} />
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(t.domains).map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs">{DOMAIN_LABELS[k] ?? k}: <b>{v as number}</b></span>)}
            </div>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => {
              const items: Row[] = t.queue[sev] ?? [];
              if (!items.length) return null;
              return (
                <section key={sev}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Badge value={sev} /> {items.length} item(s)</h3>
                  <div className="space-y-2">
                    {items.slice(0, sev === 'LOW' ? 8 : 20).map((r) => (
                      <div key={r.id} className={card}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <b>{r.title}</b>
                            <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
                            <ul className="mt-1 text-xs text-slate-500">{r.evidence?.map((e: Row, i: number) => <li key={i}>• {e.label} — <i>{e.source}</i>: {typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value ?? '')}</li>)}</ul>
                            <p className="mt-1 text-[11px] text-slate-400">Confidence {r.confidence} · priority score {r.priorityScore} · {r.agentKey}{r.dueAt && ` · due ${when(r.dueAt)}`}</p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1">
                            <button className={btn} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/task`, { method: 'POST', body: {} }), 'Task created for you')}>Create task</button>
                            <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/status`, { method: 'POST', body: { status: 'DONE' } }))}>Done</button>
                            <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/status`, { method: 'POST', body: { status: 'DISMISSED' } }))}>Dismiss</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {Object.values(t.queue).every((a) => (a as Row[]).length === 0) && <p className="text-sm text-slate-500">Nothing needs attention. Run the scan to look again.</p>}
            <p className="text-[11px] text-slate-400">{t.note}</p>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
