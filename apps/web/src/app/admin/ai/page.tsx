'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ApprovalsPanel } from '@/components/ai/ApprovalsPanel';
import { Badge, Msg, Row, Stat, Table, btn, btnDanger, btnGhost, card, input, td, usd, useAction, when } from '@/components/ai/ui';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

type Tab = 'dashboard' | 'agents' | 'tools' | 'providers' | 'executions' | 'approvals' | 'costs' | 'feedback' | 'safety' | 'knowledge' | 'controls' | 'memory' | 'audit';
const TABS: [Tab, string][] = [
  ['dashboard', 'Dashboard'], ['agents', 'Agents & versions'], ['tools', 'Tools & permissions'], ['providers', 'Models & providers'],
  ['executions', 'Executions'], ['approvals', 'Approvals'], ['costs', 'Costs & budgets'], ['feedback', 'Feedback & quality'],
  ['safety', 'Safety incidents'], ['knowledge', 'Knowledge base'], ['controls', 'Policies & kill switch'], ['memory', 'Memory'], ['audit', 'Audit log'],
];

// ------------------------------------------------------------------ dashboard
function Dashboard() {
  const { data: o, error } = useApi<Row>('/ai/overview?days=7');
  if (error) return <Msg error={error} />;
  if (!o) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Agent runs (7 days)" value={o.executions.total} hint={`${o.executions.completed} completed · ${o.executions.failed} failed`} />
        <Stat label="Human hand-overs" value={o.humanHandoffs} hint={`${o.executions.escalated} escalated runs`} />
        <Stat label="Tokens / estimated cost" value={`${(o.tokens.prompt + o.tokens.completion).toLocaleString()}`} hint={`≈ ${usd(o.costUsd)} (estimate)`} />
        <Stat label="Blocked attempts" value={o.safety.blockedAttempts} hint="Stopped in code, not by the model" />
        <Stat label="Tool calls" value={o.toolCalls.total} hint={`${o.toolCalls.errors} errors or refusals`} />
        <Stat label="Approvals" value={Object.entries(o.approvals).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || '0'} />
        <Stat label="Average latency" value={o.executions.avgLatencyMs ? `${o.executions.avgLatencyMs} ms` : '—'} />
        <Stat label="Running now" value={Object.entries(o.activeNow).map(([k, v]) => `${v} ${k.toLowerCase().replace('_', ' ')}`).join(' · ') || 'none'} />
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold">Quality (indicative — each component has its own sample size)</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-5">
          {[['Accuracy (rated)', o.quality.accuracy], ['Tool success', o.quality.toolSuccessRate], ['Human correction rate', o.quality.humanCorrectionRate], ['Escalation rate', o.quality.escalationRate]].map(([l, v]) => (
            <div key={l as string}><dt className="text-xs text-slate-500">{l}</dt><dd className="text-lg font-semibold">{v == null ? 'not enough data' : `${v}%`}</dd></div>
          ))}
          <div><dt className="text-xs text-slate-500">Hallucination reports</dt><dd className="text-lg font-semibold">{o.quality.hallucinationReports}</dd></div>
        </dl>
        <p className="mt-2 text-[11px] text-slate-400">{o.quality.note}</p>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Per agent</h3>
        <Table head={['Agent', 'Status', 'Runs', 'Tokens', 'Cost', 'Avg latency']} empty={o.perAgent.length ? undefined : 'No runs yet.'}>
          {o.perAgent.map((a: Row) => (
            <tr key={a.agent}><td className={td}>{a.name ?? a.agent}</td><td className={td}><Badge value={a.status ?? 'ACTIVE'} /></td><td className={td}>{a.runs}</td><td className={td}>{a.tokens.toLocaleString()}</td><td className={td}>{usd(a.costUsd)}</td><td className={td}>{a.avgLatencyMs ?? '—'} ms</td></tr>
          ))}
        </Table>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold">Safety (last 7 days)</h3>
        <p className="mt-1 text-xs text-slate-500">{o.safety.note}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(o.safety.byKind).map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs">{k.replace(/_/g, ' ').toLowerCase()}: <b>{v as number}</b></span>)}
          {Object.keys(o.safety.byKind).length === 0 && <span className="text-sm text-slate-500">Nothing recorded.</span>}
        </div>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold">Controls currently in force</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {o.controls.map((c: Row, i: number) => <li key={i}><Badge value={c.scope} /> {c.kind.replace(/_/g, ' ').toLowerCase()} {c.target && <b>{c.target}</b>} {c.reason && <span className="text-slate-500">— {c.reason}</span>}</li>)}
          {o.controls.length === 0 && <li className="text-slate-500">None. AI runs under each agent&apos;s own limits.</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ agents
function Agents() {
  const { user } = useAuth();
  const isSuper = !!user?.roles.includes('SUPER_ADMIN');
  const [refresh, setRefresh] = useState(0);
  const list = useApi<Row[]>('/ai/agents', refresh);
  const [key, setKey] = useState<string | null>(null);
  const versions = useApi<Row[]>(key ? `/ai/agents/${key}/versions` : null, refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const [draft, setDraft] = useState({ changeNote: '', autonomyLevel: '', maxSteps: '', maxToolCalls: '' });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <Table head={['Agent', 'Audience', 'Version', 'Autonomy', 'Status']}>
          {list.data?.map((a) => (
            <tr key={a.key} className={`cursor-pointer hover:bg-slate-50 ${key === a.key ? 'bg-amber-50' : ''}`} onClick={() => setKey(a.key)}>
              <td className={td}><b>{a.name}</b><div className="text-xs text-slate-400">{a.key}</div></td>
              <td className={td}>{a.audience}</td>
              <td className={td}>v{a.currentVersion?.version} <span className="text-xs text-slate-400">{a.currentVersion?.promptVersion}</span></td>
              <td className={td}>L{a.currentVersion?.config?.autonomyLevel}</td>
              <td className={td}><Badge value={a.status} /></td>
            </tr>
          ))}
        </Table>
        <Msg error={list.error} />
      </div>
      <div className="space-y-4">
        {!key && <p className="text-sm text-slate-500">Select an agent to see its versions. Behaviour changes only by publishing a new version; nothing is edited in place.</p>}
        {key && (
          <>
            <Table head={['Version', 'Status', 'Note', '']}>
              {versions.data?.map((v) => (
                <tr key={v.id}>
                  <td className={td}>v{v.version}<div className="text-xs text-slate-400">{v.promptVersion}</div></td>
                  <td className={td}><Badge value={v.status} /></td>
                  <td className={`${td} text-xs`}>{v.changeNote}<div className="text-slate-400">{when(v.publishedAt ?? v.createdAt)} · autonomy L{v.config?.autonomyLevel}, {v.config?.tools?.length} tools</div></td>
                  <td className={`${td} text-right`}>
                    {isSuper && v.status === 'DRAFT' && <button className={btn} onClick={() => void act(() => apiRequest(`/ai/versions/${v.id}/publish`, { method: 'POST' }), `Published v${v.version}`)}>Publish</button>}
                    {isSuper && v.status === 'RETIRED' && <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/agents/${key}/rollback`, { method: 'POST', body: { toVersion: v.version, note: 'Rolled back from the control centre' } }), `Rolled back to v${v.version}`)}>Roll back</button>}
                  </td>
                </tr>
              ))}
            </Table>
            {isSuper ? (
              <form className={`${card} space-y-2`} onSubmit={(e) => {
                e.preventDefault();
                const config: Row = {};
                if (draft.autonomyLevel) config.autonomyLevel = Number(draft.autonomyLevel);
                if (draft.maxSteps) config.maxSteps = Number(draft.maxSteps);
                if (draft.maxToolCalls) config.maxToolCalls = Number(draft.maxToolCalls);
                void act(() => apiRequest(`/ai/agents/${key}/versions`, { method: 'POST', body: { changeNote: draft.changeNote, config } }), 'Draft created. Publish it to make it live.');
              }}>
                <h3 className="text-sm font-semibold">Draft a new version of {key}</h3>
                <div className="grid grid-cols-3 gap-2">
                  <select className={input} value={draft.autonomyLevel} onChange={(e) => setDraft({ ...draft, autonomyLevel: e.target.value })}>
                    <option value="">Autonomy (unchanged)</option>
                    {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>Level {n}</option>)}
                  </select>
                  <input className={input} placeholder="Max steps" value={draft.maxSteps} onChange={(e) => setDraft({ ...draft, maxSteps: e.target.value })} />
                  <input className={input} placeholder="Max tool calls" value={draft.maxToolCalls} onChange={(e) => setDraft({ ...draft, maxToolCalls: e.target.value })} />
                </div>
                <input className={input} placeholder="What changed and why (required)" value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} />
                <button className={btn} type="submit" disabled={draft.changeNote.length < 5}>Create draft</button>
                <p className="text-[11px] text-slate-400">Level 5 is not offered: high-impact actions always need a person, whatever the level.</p>
              </form>
            ) : <p className="text-xs text-slate-500">Only a platform administrator can publish agent versions.</p>}
            <Msg error={error ?? versions.error} notice={notice} />
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tools
function Tools() {
  const { data, error } = useApi<Row[]>('/ai/tools');
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">Every capability an agent has. HIGH_RISK tools never run without a person; proposal-only tools are never executed by the AI at all.</p>
      <Msg error={error} />
      <Table head={['Tool', 'Risk', 'Used by', 'Needs permission', 'After approval']}>
        {data?.map((t) => (
          <tr key={t.key}>
            <td className={td}><b>{t.key}</b><div className="text-xs text-slate-500">{t.description}</div></td>
            <td className={td}><Badge value={t.risk} /></td>
            <td className={`${td} text-xs`}>{t.agents.join(', ') || '—'}</td>
            <td className={`${td} text-xs`}>{t.requiresPermissions.join(', ') || (t.selfService ? 'own record (customer)' : '—')}</td>
            <td className={`${td} text-xs`}>{t.risk === 'HIGH_RISK' ? (t.executesAfterApproval ? 'runs under the approver' : 'proposal only — a person does it') : '—'}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ providers
function Providers() {
  const { data, error } = useApi<Row[]>('/ai/providers');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Edited under Integrations (Super Admin). The platform does not assume a provider&apos;s privacy terms: these are what an administrator has declared.</p>
      <Msg error={error} />
      {data?.map((p) => (
        <div key={p.provider} className={card}>
          <div className="flex items-center justify-between"><h3 className="font-semibold">{p.label}</h3><span className="flex gap-2">{p.active && <Badge value="ACTIVE" />}<Badge value={p.securityStatus.split(':')[0]} /></span></div>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Model</dt><dd>{p.model}</dd></div>
            <div><dt className="text-xs text-slate-500">Region</dt><dd>{p.region ?? 'not declared'}</dd></div>
            <div><dt className="text-xs text-slate-500">Data shared</dt><dd>{p.dataSharing ?? 'not declared'}</dd></div>
            <div><dt className="text-xs text-slate-500">Retention</dt><dd>{p.retention ?? 'not declared'}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">{p.note} {p.securityStatus.includes(':') && <b>({p.securityStatus})</b>}</p>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ executions
function Executions() {
  const [status, setStatus] = useState('');
  const list = useApi<Row[]>(`/ai/executions${status ? `?status=${status}` : ''}`);
  const [id, setId] = useState<string | null>(null);
  const detail = useApi<Row>(id ? `/ai/executions/${id}` : null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['COMPLETED', 'WAITING_APPROVAL', 'FAILED', 'REJECTED', 'HANDED_OFF', 'ESCALATED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <Table head={['When', 'Agent', 'Status', 'Tokens']}>
          {list.data?.map((e) => (
            <tr key={e.id} className={`cursor-pointer hover:bg-slate-50 ${id === e.id ? 'bg-amber-50' : ''}`} onClick={() => setId(e.id)}>
              <td className={`${td} text-xs`}>{when(e.startedAt)}{e.dryRun && <Badge value="SIMULATED" />}</td>
              <td className={td}>{e.agent.name}<div className="max-w-[16rem] truncate text-xs text-slate-400">{e.objective}</div></td>
              <td className={td}><Badge value={e.status} /></td>
              <td className={td}>{e.promptTokens + e.completionTokens}</td>
            </tr>
          ))}
        </Table>
        <Msg error={list.error} />
      </div>
      <div className={card}>
        {!detail.data && <p className="text-sm text-slate-500">Select a run to see every step: the model turns, the tools, the approvals and what was refused.</p>}
        {detail.data && (
          <div className="space-y-3 text-sm">
            <div><b>{detail.data.agent.name}</b> v{detail.data.agentVersion.version} · prompt {detail.data.promptVersion} · {detail.data.provider}/{detail.data.model} · {detail.data.channel}</div>
            <p className="rounded bg-slate-50 p-2 text-xs">{detail.data.objective}</p>
            <ol className="space-y-2">
              {detail.data.steps.map((s: Row) => (
                <li key={s.id} className="rounded border border-slate-200 p-2">
                  <div className="flex items-center justify-between"><span><b>{s.seq}.</b> {s.kind}{s.toolKey && <> · <code>{s.toolKey}</code></>}</span><Badge value={s.status} /></div>
                  {s.error && <p className="text-xs text-red-700">{s.error}</p>}
                  {s.input && <pre className="mt-1 max-h-24 overflow-auto text-[11px] text-slate-500">{JSON.stringify(s.input)}</pre>}
                </li>
              ))}
            </ol>
            {detail.data.result && <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(detail.data.result, null, 1)}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ costs
function Costs() {
  const [refresh, setRefresh] = useState(0);
  const budgets = useApi<Row[]>('/ai/budgets', refresh);
  const usage = useApi<Row>('/ai/budgets/usage', refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const [f, setF] = useState({ agentKey: '', period: 'DAILY', maxRequests: '', maxTokens: '', maxCostMicros: '' });
  return (
    <div className="space-y-4">
      <Table head={['Scope', 'Agent', 'Period', 'Requests', 'Tokens', 'Cost (µ$)']} empty={budgets.data?.length === 0 ? 'No budgets set: only each agent’s per-run limits apply.' : undefined}>
        {budgets.data?.map((b) => <tr key={b.id}><td className={td}>{b.scopeKey === 'GLOBAL' ? 'Platform' : 'Company'}</td><td className={td}>{b.agentKey || 'all agents'}</td><td className={td}>{b.period}</td><td className={td}>{b.maxRequests ?? '—'}</td><td className={td}>{b.maxTokens ?? '—'}</td><td className={td}>{b.maxCostMicros ?? '—'}</td></tr>)}
      </Table>
      <form className={`${card} grid gap-2 sm:grid-cols-6`} onSubmit={(e) => {
        e.preventDefault();
        const n = (v: string) => (v ? Number(v) : undefined);
        void act(() => apiRequest('/ai/budgets', { method: 'POST', body: { agentKey: f.agentKey || undefined, period: f.period, maxRequests: n(f.maxRequests), maxTokens: n(f.maxTokens), maxCostMicros: n(f.maxCostMicros) } }), 'Budget saved');
      }}>
        <input className={input} placeholder="Agent key (blank = all)" value={f.agentKey} onChange={(e) => setF({ ...f, agentKey: e.target.value })} />
        <select className={input} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option>DAILY</option><option>MONTHLY</option></select>
        <input className={input} placeholder="Max requests" value={f.maxRequests} onChange={(e) => setF({ ...f, maxRequests: e.target.value })} />
        <input className={input} placeholder="Max tokens" value={f.maxTokens} onChange={(e) => setF({ ...f, maxTokens: e.target.value })} />
        <input className={input} placeholder="Max cost (millionths of $)" value={f.maxCostMicros} onChange={(e) => setF({ ...f, maxCostMicros: e.target.value })} />
        <button className={btn} type="submit">Save</button>
      </form>
      <Msg error={error ?? budgets.error} notice={notice} />
      <div className={card}>
        <h3 className="text-sm font-semibold">Current usage against budgets</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {usage.data?.usage?.map((u: Row, i: number) => (
            <li key={i}>{u.agentKey || 'all agents'} · {u.period.toLowerCase()}: {u.usedRequests} requests, {u.usedTokens} tokens — <b>{Math.round(u.fraction * 100)}%</b> of the tightest limit</li>
          ))}
          {!usage.data?.usage?.length && <li className="text-slate-500">No budgets to measure against.</li>}
        </ul>
        {usage.data && !usage.data.ok && <p className="mt-2 text-sm font-medium text-red-700">Blocked: {usage.data.reason}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ feedback / safety / audit
function Feedback() {
  const list = useApi<Row[]>('/ai/feedback');
  const o = useApi<Row>('/ai/overview?days=30');
  return (
    <div className="space-y-4">
      {o.data && <div className="flex flex-wrap gap-2 text-sm">{Object.entries(o.data.feedback).map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-3 py-1">{k.toLowerCase()}: <b>{v as number}</b></span>)}{Object.keys(o.data.feedback).length === 0 && <span className="text-slate-500">No ratings yet. Staff and customers rate answers in the copilot and the assistant.</span>}</div>}
      <Table head={['When', 'Rating', 'Agent', 'About', 'Note']}>
        {list.data?.map((f) => <tr key={f.id}><td className={`${td} text-xs`}>{when(f.createdAt)}</td><td className={td}><Badge value={f.rating === 'UNSAFE' ? 'HIGH' : f.rating === 'INCORRECT' ? 'MEDIUM' : 'OK'} /> {f.rating.toLowerCase()}</td><td className={td}>{f.execution?.agent?.name ?? '—'}</td><td className={`${td} max-w-xs truncate text-xs`}>{f.execution?.objective}</td><td className={`${td} text-xs`}>{f.note}</td></tr>)}
      </Table>
      <Msg error={list.error} />
    </div>
  );
}
function Safety() {
  const list = useApi<Row[]>('/ai/safety-events');
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">Attempts the system blocked. High-severity ones also open an incident under Security &amp; Compliance (one per kind per day).</p>
      <Table head={['When', 'Kind', 'Severity', 'Agent', 'Evidence']}>
        {list.data?.map((e) => <tr key={e.id}><td className={`${td} text-xs`}>{when(e.createdAt)}</td><td className={td}>{e.kind.replace(/_/g, ' ').toLowerCase()}</td><td className={td}><Badge value={e.severity} /></td><td className={td}>{e.agentKey ?? '—'}</td><td className={`${td} max-w-sm truncate font-mono text-[11px]`}>{JSON.stringify(e.evidence)}</td></tr>)}
      </Table>
      <Msg error={list.error} />
    </div>
  );
}
function Audit() {
  const list = useApi<Row[]>('/ai/audit');
  return (
    <Table head={['When', 'Action', 'Entity', 'Detail']}>
      {list.data?.map((a) => <tr key={a.id}><td className={`${td} text-xs`}>{when(a.createdAt)}</td><td className={td}>{a.action}</td><td className={`${td} text-xs`}>{a.entityType} {a.entityId?.slice(0, 8)}</td><td className={`${td} max-w-sm truncate font-mono text-[11px]`}>{a.reason} {JSON.stringify(a.metadata)}</td></tr>)}
    </Table>
  );
}

// ------------------------------------------------------------------ knowledge
function Knowledge() {
  const [refresh, setRefresh] = useState(0);
  const list = useApi<Row[]>('/ai/knowledge', refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const [f, setF] = useState({ category: 'REFUND', title: '', content: '', sourceLabel: '' });
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Policies the assistants may quote. Each is versioned, has effective dates, and is cited by its label. If nothing matches, the assistant says so and hands over.</p>
      <form className={`${card} space-y-2`} onSubmit={(e) => { e.preventDefault(); void act(() => apiRequest('/ai/knowledge', { method: 'POST', body: { ...f, sourceLabel: f.sourceLabel || undefined } }), 'Published'); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          <select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['COMPANY_POLICY', 'TRAVEL_POLICY', 'VISA', 'HAJJ', 'UMRAH', 'PAYMENT', 'REFUND', 'SUPPORT', 'SUPPLIER', 'SOP'].map((c) => <option key={c}>{c}</option>)}</select>
          <input className={input} placeholder="Title (a new version replaces the same title)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input className={input} placeholder="Citation label (optional)" value={f.sourceLabel} onChange={(e) => setF({ ...f, sourceLabel: e.target.value })} />
        </div>
        <textarea className={input} rows={4} placeholder="The policy text (no passwords or keys)" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
        <button className={btn} type="submit" disabled={f.title.length < 3 || f.content.length < 10}>Publish</button>
      </form>
      <Msg error={error ?? list.error} notice={notice} />
      <Table head={['Category', 'Title', 'Version', 'Scope', 'Status', '']}>
        {list.data?.map((k) => <tr key={k.id}><td className={td}>{k.category}</td><td className={td}>{k.title}<div className="max-w-xs truncate text-xs text-slate-400">{k.content}</div></td><td className={td}>v{k.version}</td><td className={td}>{k.companyId ? 'Company' : 'Platform'}</td><td className={td}><Badge value={k.status} /></td><td className={td}>{k.status === 'PUBLISHED' && <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/knowledge/${k.id}/retire`, { method: 'POST' }), 'Retired')}>Retire</button>}</td></tr>)}
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ controls
function Controls() {
  const [refresh, setRefresh] = useState(0);
  const list = useApi<Row[]>('/ai/controls', refresh);
  const agents = useApi<Row[]>('/ai/agents');
  const tools = useApi<Row[]>('/ai/tools');
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const [reason, setReason] = useState('');
  const [agent, setAgent] = useState('');
  const [tool, setTool] = useState('');
  const [cap, setCap] = useState('2');
  const on = (kind: string, target = '') => list.data?.some((c) => c.kind === kind && c.targetKey === target && c.value?.enabled !== false);
  const set = (kind: string, targetKey = '', value?: Row) => act(() => apiRequest('/ai/controls', { method: 'POST', body: { kind, targetKey, value, reason: reason || undefined } }), 'Applied (audited)');
  const clear = (kind: string, targetKey = '') => act(() => apiRequest('/ai/controls/clear', { method: 'POST', body: { kind, targetKey } }), 'Lifted (audited)');
  return (
    <div className="space-y-4">
      <div className={`${card} border-red-200`}>
        <h3 className="text-sm font-semibold text-red-800">Emergency kill switch</h3>
        <p className="text-xs text-slate-500">Turning protection on is instant. Lifting it asks you to confirm your identity again. Every change is audited with your reason.</p>
        <input className={`${input} mt-2`} placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded border border-slate-200 p-3"><b className="text-sm">Disable ALL AI</b><p className="text-xs text-slate-500">Assistants stop answering; staff are told it is off.</p>
            {on('ALL_DISABLED') ? <button className={btn} onClick={() => void clear('ALL_DISABLED')}>Re-enable AI</button> : <button className={btnDanger} onClick={() => void set('ALL_DISABLED')}>Disable all AI</button>}</div>
          <div className="rounded border border-slate-200 p-3"><b className="text-sm">Disable autonomous execution</b><p className="text-xs text-slate-500">Agents may answer and draft, never act on their own.</p>
            {on('AUTONOMOUS_DISABLED') ? <button className={btn} onClick={() => void clear('AUTONOMOUS_DISABLED')}>Allow again</button> : <button className={btnDanger} onClick={() => void set('AUTONOMOUS_DISABLED')}>Disable autonomy</button>}</div>
          <div className="rounded border border-slate-200 p-3"><b className="text-sm">Force human approval</b><p className="text-xs text-slate-500">Every change an agent wants becomes an approval request.</p>
            {on('FORCE_APPROVAL') ? <button className={btn} onClick={() => void clear('FORCE_APPROVAL')}>Stop forcing</button> : <button className={btnDanger} onClick={() => void set('FORCE_APPROVAL')}>Force approval</button>}</div>
          <div className="rounded border border-slate-200 p-3"><b className="text-sm">Autonomy ceiling</b><p className="text-xs text-slate-500">No agent may exceed this level here.</p>
            <div className="flex gap-2"><select className="rounded border border-slate-300 px-2 py-1 text-sm" value={cap} onChange={(e) => setCap(e.target.value)}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>Level {n}</option>)}</select><button className={btn} onClick={() => void set('AUTONOMY_CAP', '', { level: Number(cap) })}>Set</button><button className={btnGhost} onClick={() => void clear('AUTONOMY_CAP')}>Remove</button></div></div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h3 className="text-sm font-semibold">Disable one agent</h3>
          <div className="mt-2 flex gap-2"><select className={input} value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Choose…</option>{agents.data?.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select><button className={btnDanger} disabled={!agent} onClick={() => void set('AGENT_DISABLED', agent)}>Disable</button></div>
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold">Disable one tool</h3>
          <div className="mt-2 flex gap-2"><select className={input} value={tool} onChange={(e) => setTool(e.target.value)}><option value="">Choose…</option>{tools.data?.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}</select><button className={btnDanger} disabled={!tool} onClick={() => void set('TOOL_DISABLED', tool)}>Disable</button></div>
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold">AI on WhatsApp</h3>
          <p className="text-xs text-slate-500">Off by default. Only verified, opted-in customers are answered; a person can always take over.</p>
          <div className="mt-2">{on('FEATURE_FLAG', 'ai.whatsapp') ? <button className={btnGhost} onClick={() => void clear('FEATURE_FLAG', 'ai.whatsapp')}>Turn off</button> : <button className={btn} onClick={() => void set('FEATURE_FLAG', 'ai.whatsapp', { enabled: true })}>Turn on</button>}</div>
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold">Customer channels</h3>
          {['portal', 'whatsapp'].map((c) => <div key={c} className="mt-1 flex items-center justify-between text-sm">{c}<button className={btnGhost} onClick={() => void set('FEATURE_FLAG', `channel.${c}`, { enabled: false })}>Block {c}</button></div>)}
        </div>
      </div>
      <Msg error={error ?? list.error} notice={notice} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">Controls in force</h3>
        <Table head={['Scope', 'Control', 'Target', 'Value', 'Reason', 'Set']} empty={list.data?.length === 0 ? 'None.' : undefined}>
          {list.data?.map((c) => <tr key={c.id}><td className={td}>{c.scopeKey === 'GLOBAL' ? 'Platform' : 'Company'}</td><td className={td}>{c.kind.replace(/_/g, ' ').toLowerCase()}</td><td className={td}>{c.targetKey || '—'}</td><td className={`${td} font-mono text-[11px]`}>{JSON.stringify(c.value)}</td><td className={`${td} text-xs`}>{c.reason}</td><td className={`${td} text-xs`}>{when(c.updatedAt)}</td></tr>)}
        </Table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ memory
function Memory() {
  const [subject, setSubject] = useState({ subjectType: 'CUSTOMER', subjectId: '' });
  const [refresh, setRefresh] = useState(0);
  const path = subject.subjectId.length > 5 ? `/ai/memory?subjectType=${subject.subjectType}&subjectId=${encodeURIComponent(subject.subjectId)}` : null;
  const list = useApi<Row[]>(path, refresh);
  const { act, error } = useAction(() => setRefresh((n) => n + 1));
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">What the assistants remember. Only approved keys are ever stored; everything expires; customers can have it deleted, and erasing a customer removes it.</p>
      <div className="flex gap-2"><select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={subject.subjectType} onChange={(e) => setSubject({ ...subject, subjectType: e.target.value })}>{['CUSTOMER', 'CONVERSATION', 'BOOKING'].map((s) => <option key={s}>{s}</option>)}</select><input className={input} placeholder="Subject id" value={subject.subjectId} onChange={(e) => setSubject({ ...subject, subjectId: e.target.value.trim() })} /></div>
      <Msg error={error ?? list.error} />
      <Table head={['Type', 'Key', 'Value', 'Expires', '']} empty={path && list.data?.length === 0 ? 'Nothing stored.' : undefined}>
        {list.data?.map((m) => <tr key={m.id}><td className={td}>{m.type}</td><td className={td}>{m.key}</td><td className={`${td} font-mono text-[11px]`}>{JSON.stringify(m.value)}</td><td className={`${td} text-xs`}>{when(m.expiresAt)}</td><td className={td}><button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/memory/${m.id}`, { method: 'DELETE' }))}>Forget</button></td></tr>)}
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function AiControlCenter() {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="AI Control Center" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">AI Control Center</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Governance for the AI agents: what they can do, what they did, what it cost, what was blocked, and the switches to stop them. The agents act only for the person using them, never beyond that person&apos;s own permissions, and never without a human for high-impact actions.</p>
        <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
        </div>
        <div className="mt-6">
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'agents' && <Agents />}
          {tab === 'tools' && <Tools />}
          {tab === 'providers' && <Providers />}
          {tab === 'executions' && <Executions />}
          {tab === 'approvals' && <ApprovalsPanel />}
          {tab === 'costs' && <Costs />}
          {tab === 'feedback' && <Feedback />}
          {tab === 'safety' && <Safety />}
          {tab === 'knowledge' && <Knowledge />}
          {tab === 'controls' && <Controls />}
          {tab === 'memory' && <Memory />}
          {tab === 'audit' && <Audit />}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
