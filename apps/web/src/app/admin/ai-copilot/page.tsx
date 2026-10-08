'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApprovalsPanel } from '@/components/ai/ApprovalsPanel';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Badge, Msg, Row, Table, btn, btnGhost, card, input, td, useAction } from '@/components/ai/ui';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorText, useApi } from '@/lib/use-api';

const STAFF_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF'];
const AGENTS: [string, string][] = [
  ['staff_copilot', 'Staff Copilot (general)'], ['sales_agent', 'Sales Agent'], ['crm_agent', 'CRM Agent'], ['finance_assistant', 'Finance Assistant'],
  ['flight_ops', 'Flight Operations'], ['hotel_ops', 'Hotel Operations'], ['visa_ops', 'Visa Operations'], ['hajj_ops', 'Hajj Operations'],
  ['umrah_ops', 'Umrah Operations'], ['group_ops', 'Group Operations'], ['supplier_agent', 'Supplier Agent'], ['b2b_agent', 'B2B / Corporate'],
  ['security_agent', 'Security Agent'], ['operations_supervisor', 'Operations Supervisor (coordinates others)'],
];
const SUGGESTIONS = ["Summarize today's operations", 'Show my pending approvals', 'Which leads need follow-up?', 'Create a task to call the customer about the unpaid invoice'];

interface Turn { who: 'me' | 'ai'; text: string; result?: Row; simulated?: boolean }

function Chat() {
  const [agent, setAgent] = useState('staff_copilot');
  const [dry, setDry] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, string>>({});

  async function ask(objective: string) {
    const q = objective.trim();
    if (!q || busy) return;
    setBusy(true); setError(null); setText('');
    setTurns((t) => [...t, { who: 'me', text: q }]);
    try {
      const result = await apiRequest<Row>(dry ? '/ai/simulate' : '/ai/copilot/ask', { method: 'POST', body: dry ? { agent, objective: q, customerId: customerId || undefined } : { agent, objective: q } });
      setTurns((t) => [...t, { who: 'ai', text: result.message, result, simulated: dry }]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function rate(executionId: string, rating: string) {
    await apiRequest('/ai/feedback', { method: 'POST', body: { executionId, rating } }).catch(() => undefined);
    setRated((r) => ({ ...r, [executionId]: rating }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={agent} onChange={(e) => setAgent(e.target.value)}>{AGENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> Dry run (show what it would do, change nothing)</label>
        {dry && <input className="w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Customer id (to simulate a customer agent)" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />}
      </div>
      <p className="rounded bg-violet-50 px-3 py-2 text-xs text-violet-900">You are talking to an AI. It sees only what you are allowed to see, and anything that changes money or bookings is sent for approval.</p>
      <div className="min-h-[18rem] space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        {turns.length === 0 && <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <button key={s} className={btnGhost} onClick={() => void ask(s)}>{s}</button>)}</div>}
        {turns.map((t, i) => (
          <div key={i} className={t.who === 'me' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[90%] rounded-2xl px-3 py-2 text-left text-sm ${t.who === 'me' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-slate-50'}`}>
              <p className="whitespace-pre-wrap">{t.text}</p>
              {t.result && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">How I got this · <Badge value={t.result.status} /> · confidence {t.result.confidence} {t.simulated && <Badge value="SIMULATED" />}</summary>
                  <p className="mt-1">Sources: {t.result.sources.join(' · ') || 'none (no data was needed)'}</p>
                  <ol className="mt-1 list-decimal ps-5">{t.result.steps.map((s: Row) => <li key={s.seq}>{s.kind.toLowerCase()} {s.tool && <code>{s.tool}</code>} — {s.status.toLowerCase().replace('_', ' ')} {s.note && <span className="text-slate-400">({s.note})</span>}</li>)}</ol>
                  {t.result.approvals.length > 0 && <p className="mt-1 font-medium text-amber-800">{t.result.approvals.length} approval request(s) created — see the Approvals tab.</p>}
                  {!t.simulated && (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {rated[t.result.executionId] ? <span>Rated: {rated[t.result.executionId].toLowerCase()}</span> : ['CORRECT', 'PARTIAL', 'INCORRECT', 'UNSAFE', 'NEEDS_REVIEW'].map((r) => <button key={r} className={btnGhost} onClick={() => void rate(t.result!.executionId, r)}>{r.replace('_', ' ').toLowerCase()}</button>)}
                    </p>
                  )}
                </details>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400">Working…</p>}
      </div>
      <Msg error={error} />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <input className={input} placeholder="Ask the assistant…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        <button className={btn} type="submit" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}

function Suggested() {
  const [refresh, setRefresh] = useState(0);
  const list = useApi<Row[]>('/ai/recommendations', refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">Suggested actions found by fixed rules over your records. Each shows why, the evidence, and how sure the system is.</p>
      <Msg error={error ?? list.error} notice={notice} />
      {list.data?.length === 0 && <p className="text-sm text-slate-500">Nothing needs attention right now.</p>}
      {list.data?.map((r) => (
        <div key={r.id} className={card}>
          <div className="flex items-start justify-between gap-3">
            <div><Badge value={r.severity} /> <b className="ms-1">{r.title}</b><p className="mt-1 text-sm text-slate-600">{r.reason}</p>
              <ul className="mt-1 text-xs text-slate-500">{r.evidence?.map((e: Row, i: number) => <li key={i}>• {e.label} ({e.source}): {typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value ?? '')}</li>)}</ul>
              <p className="mt-1 text-[11px] text-slate-400">Confidence {r.confidence} · priority {r.priorityScore}</p></div>
            <div className="flex shrink-0 flex-col gap-1">
              <button className={btn} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/task`, { method: 'POST', body: {} }), 'Task created for you')}>Create task</button>
              <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/status`, { method: 'POST', body: { status: 'DONE' } }), 'Marked done')}>Done</button>
              <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/recommendations/${r.id}/status`, { method: 'POST', body: { status: 'DISMISSED' } }), 'Dismissed')}>Dismiss</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Assistants() {
  const [email, setEmail] = useState({ from: '', subject: '', body: '' });
  const [call, setCall] = useState({ transcript: '', callerPhone: '' });
  const [doc, setDoc] = useState({ customerId: '', fileName: '', text: '' });
  const [out, setOut] = useState<{ title: string; data: Row } | null>(null);
  const { act, error } = useAction(() => undefined);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">These read and propose. Nothing is sent, saved or acted on from here: a person checks every result.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <form className={`${card} space-y-2`} onSubmit={(e) => { e.preventDefault(); void act(async () => setOut({ title: 'Email triage (draft reply, nothing sent)', data: await apiRequest('/ai/email/triage', { method: 'POST', body: { ...email, record: true } }) })); }}>
          <h3 className="text-sm font-semibold">Email</h3>
          <input className={input} placeholder="From (customer email)" value={email.from} onChange={(e) => setEmail({ ...email, from: e.target.value })} />
          <input className={input} placeholder="Subject" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} required />
          <textarea className={input} rows={4} placeholder="Paste the email" value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} required />
          <button className={btn} type="submit">Triage</button>
        </form>
        <form className={`${card} space-y-2`} onSubmit={(e) => { e.preventDefault(); void act(async () => setOut({ title: 'Call summary (no action taken)', data: await apiRequest('/ai/voice/transcript', { method: 'POST', body: { transcript: call.transcript, callerPhone: call.callerPhone || undefined } }) })); }}>
          <h3 className="text-sm font-semibold">Call transcript</h3>
          <input className={input} placeholder="Caller phone (optional)" value={call.callerPhone} onChange={(e) => setCall({ ...call, callerPhone: e.target.value })} />
          <textarea className={input} rows={5} placeholder="Paste the transcript" value={call.transcript} onChange={(e) => setCall({ ...call, transcript: e.target.value })} required />
          <button className={btn} type="submit">Summarise</button>
        </form>
        <form className={`${card} space-y-2`} onSubmit={(e) => { e.preventDefault(); void act(async () => setOut({ title: 'Document proposal (nothing saved)', data: await apiRequest('/ai/documents/propose', { method: 'POST', body: { customerId: doc.customerId, fileName: doc.fileName, text: doc.text || undefined } }) })); }}>
          <h3 className="text-sm font-semibold">Document</h3>
          <input className={input} placeholder="Customer id" value={doc.customerId} onChange={(e) => setDoc({ ...doc, customerId: e.target.value })} required />
          <input className={input} placeholder="File name" value={doc.fileName} onChange={(e) => setDoc({ ...doc, fileName: e.target.value })} required />
          <textarea className={input} rows={3} placeholder="Text read from the file (OCR / passport MRZ)" value={doc.text} onChange={(e) => setDoc({ ...doc, text: e.target.value })} />
          <button className={btn} type="submit">Propose</button>
        </form>
      </div>
      <Msg error={error} />
      {out && <div className={card}><h3 className="text-sm font-semibold">{out.title}</h3><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(out.data, null, 2)}</pre></div>}
    </div>
  );
}

function Conversations() {
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('PAUSED');
  const list = useApi<Row[]>(`/ai/conversations?status=${status}`, refresh);
  const [id, setId] = useState<string | null>(null);
  const detail = useApi<Row>(id ? `/ai/conversations/${id}` : null, refresh);
  const [reply, setReply] = useState('');
  const { act, error } = useAction(() => setRefresh((n) => n + 1));
  const call = (path: string, body?: Row) => act(() => apiRequest(`/ai/conversations/${id}/${path}`, { method: 'POST', body }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>{['PAUSED', 'HUMAN_TAKEN', 'AI_ACTIVE', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</select>
        <Table head={['Customer', 'Channel', 'Last message', 'Status']} empty={list.data?.length === 0 ? 'None.' : undefined}>
          {list.data?.map((c) => <tr key={c.id} className={`cursor-pointer hover:bg-slate-50 ${id === c.id ? 'bg-amber-50' : ''}`} onClick={() => setId(c.id)}><td className={td}>{c.customer ? `${c.customer.firstName} ${c.customer.lastName}` : '—'}</td><td className={td}>{c.channel}</td><td className={`${td} text-xs`}>{new Date(c.lastMessageAt).toLocaleString()}</td><td className={td}><Badge value={c.status} /></td></tr>)}
        </Table>
        <Msg error={list.error} />
      </div>
      <div className={card}>
        {!detail.data && <p className="text-sm text-slate-500">Select a conversation to read it, see what the AI did, and take over.</p>}
        {detail.data && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => void call('takeover')}>Take over</button>
              <button className={btnGhost} onClick={() => void call('pause')}>Pause AI</button>
              <button className={btnGhost} onClick={() => void call('resume')}>Resume AI</button>
              <button className={btnGhost} onClick={() => void call('close')}>Close</button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded bg-slate-50 p-2">
              {detail.data.messages.map((m: Row) => <p key={m.id} className={m.role === 'CUSTOMER' ? '' : 'text-slate-600'}><b>{m.role}:</b> {m.content}{m.flagged && <span className="text-red-600"> ⚑</span>}</p>)}
            </div>
            <details className="text-xs text-slate-600"><summary className="cursor-pointer">What the AI did ({detail.data.executions.length} runs)</summary>
              {detail.data.executions.map((e: Row) => <div key={e.id} className="mt-2 rounded border border-slate-200 p-2"><Badge value={e.status} /> {e.agent.name} — {e.objective}<ul className="mt-1">{e.steps.map((s: Row) => <li key={s.seq}>{s.kind.toLowerCase()} {s.toolKey && <code>{s.toolKey}</code>} · {s.status.toLowerCase()}</li>)}</ul>{e.approvals.length > 0 && <p className="text-amber-800">Proposed: {e.approvals.map((a: Row) => `${a.toolKey} (${a.status})`).join(', ')}</p>}</div>)}
            </details>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void call('reply', { content: reply }).then(() => setReply('')); }}>
              <input className={input} placeholder="Reply as staff (takes over the conversation)" value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className={btn} type="submit" disabled={!reply.trim()}>Send</button>
            </form>
          </div>
        )}
        <Msg error={error ?? detail.error} />
      </div>
    </div>
  );
}

type Tab = 'chat' | 'suggested' | 'approvals' | 'conversations' | 'assistants';
export default function CopilotPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('chat');
  const nav = user?.roles.includes('FINANCE_OFFICER') && !user.roles.some((r) => r === 'COMPANY_ADMIN' || r === 'SUPER_ADMIN') ? FINANCE_NAV : ADMIN_NAV;
  const tabs: [Tab, string][] = [['chat', 'Ask the copilot'], ['suggested', 'Suggested actions'], ['approvals', 'Approvals'], ['conversations', 'Customer chats'], ['assistants', 'Email · calls · documents']];
  return (
    <ProtectedRoute allowedRoles={STAFF_ROLES}>
      <AppShell title="AI Copilot" navLinks={nav}>
        <h2 className="text-lg font-semibold text-slate-900">AI Copilot</h2>
        <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}
        </div>
        <div className="mt-6">
          {tab === 'chat' && <Chat />}
          {tab === 'suggested' && <Suggested />}
          {tab === 'approvals' && <ApprovalsPanel />}
          {tab === 'conversations' && <Conversations />}
          {tab === 'assistants' && <Assistants />}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
