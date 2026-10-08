'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Badge, Msg, Row, btn, btnGhost, card, input, useAction } from '@/components/ai/ui';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { errorText, useApi } from '@/lib/use-api';

const QUESTIONS = [
  ['Revenue and bookings', 'What was our revenue in the last 30 days?'],
  ['Sales by branch', 'Show branch sales for the last 30 days'],
  ['Top routes', 'Top 5 routes by revenue this month'],
  ['Supplier liabilities', 'What do we owe suppliers?'],
  ['Pending incentives', 'How much incentive expense is pending?'],
  ['Visas expiring', 'Which visas are expiring soon?'],
  ['Cancellations', 'How many bookings were cancelled this month?'],
] as const;

export default function ExecutivePage() {
  const [refresh, setRefresh] = useState(0);
  const briefing = useApi<Row>('/ai/briefing', refresh);
  const { act, error, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const [answers, setAnswers] = useState<{ q: string; r: Row }[]>([]);
  const [custom, setCustom] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const b = briefing.data?.content;

  async function ask(q: string) {
    setAsking(true); setAskError(null);
    try {
      const r = await apiRequest<Row>('/ai/copilot/ask', { method: 'POST', body: { agent: 'executive_assistant', objective: q } });
      setAnswers((a) => [{ q, r }, ...a]);
    } catch (e) {
      setAskError(errorText(e));
    } finally {
      setAsking(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Executive AI Assistant" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Executive AI Assistant</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Management answers built only from the approved analytics queries and recorded data. Every number says where it came from; nothing is estimated by a model.</p>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Daily briefing {b && <span className="font-normal text-slate-500">— {b.date}</span>}</h3>
            <button className={btnGhost} disabled={busy} onClick={() => void act(() => apiRequest('/ai/briefing/generate', { method: 'POST' }), 'Briefing refreshed')}>Refresh now</button>
          </div>
          <Msg error={error ?? briefing.error} notice={notice} />
          {b && (
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className={card}>
                <h4 className="text-sm font-semibold">Figures</h4>
                <dl className="mt-2 space-y-2 text-sm">
                  {b.figures.map((f: Row) => (
                    <div key={f.label} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-1">
                      <dt className="text-slate-600">{f.label}<div className="text-[11px] text-slate-400">Source: {f.source}</div></dt>
                      <dd className="max-w-[55%] text-right font-medium">{String(f.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={card}>
                <h4 className="text-sm font-semibold">Recommended actions</h4>
                {b.recommendedActions.length === 0 && <p className="mt-2 text-sm text-slate-500">No open exceptions.</p>}
                <ol className="mt-2 space-y-3 text-sm">
                  {b.recommendedActions.map((r: Row, i: number) => (
                    <li key={r.id}><Badge value={r.severity} /> <b>{i + 1}. {r.title}</b><p className="text-slate-600">{r.why}</p><p className="text-[11px] text-slate-400">Confidence {r.confidence} · evidence: {r.evidence?.map((e: Row) => e.label).join('; ')}</p></li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h3 className="text-sm font-semibold">Ask a management question</h3>
          <div className="mt-2 flex flex-wrap gap-2">{QUESTIONS.map(([label, q]) => <button key={label} className={btnGhost} disabled={asking} onClick={() => void ask(q)}>{label}</button>)}</div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) void ask(custom.trim()); setCustom(''); }}>
            <input className={input} placeholder="e.g. What was total ticket sales in the last 7 days?" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className={btn} type="submit" disabled={asking}>Ask</button>
          </form>
          <Msg error={askError} />
          <div className="mt-4 space-y-3">
            {answers.map((a, i) => (
              <div key={i} className={card}>
                <p className="text-xs text-slate-500">{a.q}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{a.r.message}</p>
                <p className="mt-2 text-[11px] text-slate-400">Source: {a.r.sources.join(' · ') || '—'} · confidence {a.r.confidence}</p>
              </div>
            ))}
          </div>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
