'use client';

import { useState } from 'react';
import { Badge, Msg, Row, Table, btn, btnDanger, btnGhost, card, input, td, useAction, when } from '@/components/ai/ui';
import { apiRequest } from '@/lib/api';
import { useApi } from '@/lib/use-api';

// ------------------------------------------------------------------ approvals
export function ApprovalsPanel() {
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('PENDING');
  const list = useApi<Row[]>(`/ai/approvals?status=${status}`, refresh);
  const [id, setId] = useState<string | null>(null);
  const detail = useApi<Row>(id ? `/ai/approvals/${id}` : null, refresh);
  const { act, error, notice } = useAction(() => setRefresh((n) => n + 1));
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState('');
  const a = detail.data;
  const p = a?.preview;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['PENDING', 'EXECUTED', 'REJECTED', 'CANCELLED', 'FAILED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <Table head={['Requested', 'Action', 'Risk', 'Agent']} empty={list.data?.length === 0 ? 'Nothing here.' : undefined}>
          {list.data?.map((r) => (
            <tr key={r.id} className={`cursor-pointer hover:bg-slate-50 ${id === r.id ? 'bg-amber-50' : ''}`} onClick={() => { setId(r.id); setEdit(''); }}>
              <td className={`${td} text-xs`}>{when(r.createdAt)}</td><td className={td}>{r.preview?.action ?? r.toolKey}</td><td className={td}><Badge value={r.risk} /></td><td className={td}>{r.agent.name}</td>
            </tr>
          ))}
        </Table>
        <Msg error={list.error} />
      </div>
      <div className={card}>
        {!a && <p className="text-sm text-slate-500">Select a request to preview exactly what would happen.</p>}
        {a && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><h3 className="font-semibold">{p?.action}</h3><Badge value={a.status} /></div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Reason</dt><dd>{a.reason}</dd></div>
              <div><dt className="text-xs text-slate-500">Affected booking</dt><dd>{p?.affectedBooking ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Required approval</dt><dd>{p?.requiredApproval} ({a.requiredRole})</dd></div>
              <div><dt className="text-xs text-slate-500">Financial impact</dt><dd>{p?.financialImpact ? JSON.stringify(p.financialImpact) : 'see preview'}</dd></div>
            </dl>
            <div><p className="text-xs font-medium text-slate-500">What will happen</p><ul className="list-disc ps-5">{p?.whatWillHappen?.map((w: string) => <li key={w}>{w}</li>)}</ul></div>
            <div><p className="text-xs font-medium text-slate-500">Risks</p><ul className="list-disc ps-5 text-red-800">{p?.risks?.map((w: string) => <li key={w}>{w}</li>)}</ul></div>
            <div><p className="text-xs font-medium text-slate-500">Proposed parameters {a.editedParams && '(edited)'}</p><pre className="rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(a.editedParams ?? a.params, null, 1)}</pre></div>
            {a.status === 'PENDING' && (
              <div className="space-y-2">
                <textarea className={input} rows={2} placeholder="Edit parameters (JSON, optional) — e.g. {&quot;reason&quot;:&quot;…&quot;}" value={edit} onChange={(e) => setEdit(e.target.value)} />
                <input className={input} placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button className={btn} onClick={() => void act(() => apiRequest(`/ai/approvals/${a.id}/decide`, { method: 'POST', body: { decision: 'APPROVE', note, ...(edit ? { editedParams: JSON.parse(edit) } : {}) } }), 'Approved')}>{edit ? 'Edit & approve' : 'Approve'}</button>
                  <button className={btnDanger} disabled={!note} onClick={() => void act(() => apiRequest(`/ai/approvals/${a.id}/decide`, { method: 'POST', body: { decision: 'REJECT', note } }), 'Rejected')}>Reject</button>
                  <button className={btnGhost} onClick={() => void act(() => apiRequest(`/ai/approvals/${a.id}/decide`, { method: 'POST', body: { decision: 'CANCEL', note } }), 'Cancelled')}>Cancel request</button>
                </div>
                <p className="text-[11px] text-slate-400">You cannot approve an action you started. Approved actions run under your name, once.</p>
              </div>
            )}
            {a.result && <pre className="rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(a.result)}</pre>}
          </div>
        )}
        <Msg error={error ?? detail.error} notice={notice} />
      </div>
    </div>
  );
}

